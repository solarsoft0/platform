package main

import (
	"encoding/base64"

	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/compute"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/container"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/projects"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/serviceaccount"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/storage"
	"github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes"
	corev1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/core/v1"
	"github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/helm/v3"
	metav1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/meta/v1"
	storev1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/storage/v1"
	"github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/yaml"
	"github.com/pulumi/pulumi/sdk/v2/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v2/go/pulumi/config"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		network, err := compute.NewNetwork(ctx, "dev", &compute.NetworkArgs{
			AutoCreateSubnetworks: pulumi.BoolPtr(true),
		})

		if err != nil {
			return err
		}

		cluster, err := container.NewCluster(ctx, "dev", &container.ClusterArgs{
			Network:        network.SelfLink,
			NetworkingMode: pulumi.String("VPC_NATIVE"),
			IpAllocationPolicy: &container.ClusterIpAllocationPolicyArgs{
				ClusterIpv4CidrBlock:  pulumi.String(""),
				ServicesIpv4CidrBlock: pulumi.String(""),
			},
			InitialNodeCount:    pulumi.Int(1),
			EnableShieldedNodes: pulumi.BoolPtr(true),
			LoggingService:      pulumi.StringPtr("none"),
			MonitoringService:   pulumi.StringPtr("none"),
			ReleaseChannel:      &container.ClusterReleaseChannelArgs{Channel: pulumi.String("STABLE")},
			NetworkPolicy:       &container.ClusterNetworkPolicyArgs{Enabled: pulumi.Bool(true)},

			// Default node pool is remove anyway
			RemoveDefaultNodePool: pulumi.Bool(true),
			// Disable Google's ingress, as we use Nginx
			AddonsConfig: &container.ClusterAddonsConfigArgs{
				HttpLoadBalancing: &container.ClusterAddonsConfigHttpLoadBalancingArgs{Disabled: pulumi.Bool(true)},
			},
		})
		if err != nil {
			return err
		}

		k8sProvider, err := kubernetes.NewProvider(ctx, "cluster", &kubernetes.ProviderArgs{
			Kubeconfig: generateKubeconfig(cluster),
		})
		if err != nil {
			return err
		}

		np, err := container.NewNodePool(ctx, "micro", &container.NodePoolArgs{
			Cluster:          cluster.Name,
			InitialNodeCount: pulumi.Int(1),
			Autoscaling: &container.NodePoolAutoscalingArgs{
				MinNodeCount: pulumi.Int(1),
				MaxNodeCount: pulumi.Int(3),
			},
			NodeConfig: &container.NodePoolNodeConfigArgs{
				Preemptible: pulumi.Bool(true),
				MachineType: pulumi.String("e2-standard-2"),
			},
		})
		if err != nil {
			return err
		}

		ctx.Export("nodepool", np.Name)

		// SSD Storage
		_, err = storev1.NewStorageClass(ctx, "ssd", &storev1.StorageClassArgs{
			AllowVolumeExpansion: pulumi.Bool(true),
			Parameters:           pulumi.StringMap{"type": pulumi.String("pd-ssd")},
			Metadata:             &metav1.ObjectMetaArgs{Name: pulumi.String("ssd")},
			Provisioner:          pulumi.String("kubernetes.io/gce-pd"),
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// Cert manager
		ns, err := corev1.NewNamespace(ctx, "cert-manager", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("cert-manager"),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		c := config.New(ctx, "")
		corev1.NewSecret(ctx, "cloudflare-api-key", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("cloudflare-api-key"),
			},
			StringData: pulumi.StringMap{
				"cloudflare": pulumi.String(c.Require("cloudflare-api-key")),
			},
		}, pulumi.Provider(k8sProvider))

		_, err = helm.NewChart(ctx, "certmanager", helm.ChartArgs{
			Namespace: pulumi.String("cert-manager"),
			Chart:     pulumi.String("cert-manager"),
			Version:   pulumi.String("v1.0.3"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://charts.jetstack.io"),
			},
			Values: pulumi.Map{
				"installCRDs": pulumi.Bool(true),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// Create a letsencrypt issuer
		_, err = yaml.NewConfigFile(ctx, "letsencryptcerts", &yaml.ConfigFileArgs{
			File: "issueracme.yaml",
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// Root certs for CA
		corev1.NewSecret(ctx, "ca", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("ca"),
			},
			StringData: pulumi.StringMap{
				"tls.crt": pulumi.String(c.Require("ca-crt")),
				"tls.key": pulumi.String(c.Require("ca-key")),
			},
		}, pulumi.Provider(k8sProvider))

		// Create a cluster wide CA
		_, err = yaml.NewConfigFile(ctx, "customca", &yaml.ConfigFileArgs{
			File: "issuercustomca.yaml",
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// -------- ETCD ----------
		// Cert manager
		ns, err = corev1.NewNamespace(ctx, "etcd", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("etcd"),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = yaml.NewConfigFile(ctx, "etcdcerts", &yaml.ConfigFileArgs{
			File: "etcd/certs.yml",
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = helm.NewChart(ctx, "etcd", helm.ChartArgs{
			Namespace: pulumi.String("etcd"),
			Chart:     pulumi.String("etcd"),
			Version:   pulumi.String("4.12.2"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://charts.bitnami.com/bitnami"),
			},
			Values: pulumi.Map{
				"statefulset": pulumi.Map{
					"replicaCount": pulumi.Int(1),
				},
				"readinessProbe": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				"livenessProbe": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				"metrics": pulumi.Map{
					"enabled": pulumi.Bool(true),
				},
				"auth": pulumi.Map{
					"rbac": pulumi.Map{
						"enabled": pulumi.Bool(false),
					},
					"client": pulumi.Map{
						"secureTransport":      pulumi.Bool(true),
						"enableAuthentication": pulumi.Bool(true),
						"existingSecret":       pulumi.String("etcd-client-certs"),
						"certFilename":         pulumi.String("tls.crt"),
						"certKeyFilename":      pulumi.String("tls.key"),
						"caFilename":           pulumi.String("ca.crt"),
					},
					"peer": pulumi.Map{
						"secureTransport":      pulumi.Bool(true),
						"enableAuthentication": pulumi.Bool(true),
						"existingSecret":       pulumi.String("etcd-peer-certs"),
						"certFilename":         pulumi.String("tls.crt"),
						"certKeyFilename":      pulumi.String("tls.key"),
						"caFilename":           pulumi.String("ca.crt"),
					},
				},
				// TODO
				// "affinity": pulumi.Map{
				// 	"podAntiAffinity": pulumi.Map{},
				// },
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// -------- MINIO ----------
		ns, err = corev1.NewNamespace(ctx, "minio", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("minio"),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = yaml.NewConfigFile(ctx, "miniocerts", &yaml.ConfigFileArgs{
			File: "minio/certs.yml",
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		sa, err := serviceaccount.NewAccount(ctx, "minio", &serviceaccount.AccountArgs{
			AccountId: pulumi.String("miniostorage"),
		})
		if err != nil {
			return err
		}
		_, err = projects.NewIAMBinding(ctx, "minio-storage-admin-binding", &projects.IAMBindingArgs{
			Members: pulumi.StringArray{pulumi.Sprintf("serviceAccount:%s", sa.Email)},
			Role:    pulumi.String("roles/storage.admin"),
		})
		if err != nil {
			return err
		}

		key, err := serviceaccount.NewKey(ctx, "minio-gcs", &serviceaccount.KeyArgs{
			ServiceAccountId: sa.ID(),
		})

		_, err = helm.NewChart(ctx, "minio", helm.ChartArgs{
			Namespace: pulumi.String("minio"),
			Chart:     pulumi.String("minio"),
			Version:   pulumi.String("8.0.0"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://helm.min.io/"),
			},
			Values: pulumi.Map{
				"tls": pulumi.Map{
					"enabled":    pulumi.Bool(true),
					"certSecret": pulumi.String("minio-tls"),
					"publicCrt":  pulumi.String("tls.crt"),
					"privateKey": pulumi.String("tls.key"),
				},
				"service": pulumi.Map{
					"port": pulumi.String("443"),
				},
				"persistence": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				"gcsgateway": pulumi.Map{
					"replicas":  pulumi.Int(1),
					"enabled":   pulumi.Bool(true),
					"projectId": pulumi.String(config.Get(ctx, "gcp:project")),
					"gcsKeyJson": key.PrivateKey.ApplyString(func(s string) string {
						str, _ := base64.StdEncoding.DecodeString(s)
						return string(str)
					}),
				},
				"accessKey": pulumi.String(c.Require("minio-access-key")),
				"secretKey": pulumi.String(c.Require("minio-secret-key")),
				"resources": pulumi.Map{
					"requests": pulumi.Map{
						"memory": pulumi.String("512"),
					},
				},
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// -------- Timescaledb ----------
		ns, err = corev1.NewNamespace(ctx, "timescale", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("timescale"),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		bucket, err := storage.NewBucket(ctx, "timescalebackups", &storage.BucketArgs{
			Name:     pulumi.String("timescalebackups"),
			Location: pulumi.String(config.Get(ctx, "gcp:region")),
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = corev1.NewSecret(ctx, "timescale-credentials", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("timescale-credentials"),
			},
			StringData: pulumi.StringMap{
				"PATRONI_SUPERUSER_PASSWORD":   pulumi.String(c.Require("patroni_superuser_password")),
				"PATRONI_REPLICATION_PASSWORD": pulumi.String(c.Require("patroni_replication_password")),
				"PATRONI_admin_PASSWORD":       pulumi.String(c.Require("patroni_admin_password")),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		corev1.NewSecret(ctx, "timescale-pgbackrest", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("timescale-pgbackrest"),
			},
			StringData: pulumi.StringMap{
				"PGBACKREST_REPO1_S3_BUCKET":     bucket.Name,
				"PGBACKREST_REPO1_S3_REGION":     pulumi.String(config.Get(ctx, "gcp:region")),
				"PGBACKREST_REPO1_S3_KEY":        pulumi.String(c.Require("minio-access-key")),
				"PGBACKREST_REPO1_S3_KEY_SECRET": pulumi.String(c.Require("minio-secret-key")),
			},
		}, pulumi.Provider(k8sProvider))

		timescaleTls, err := yaml.NewConfigFile(ctx, "timescale-tls", &yaml.ConfigFileArgs{
			File: "timescale/certs.yml",
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = helm.NewChart(ctx, "timescale", helm.ChartArgs{
			Namespace: pulumi.String("timescale"),
			Chart:     pulumi.String("timescaledb-single"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://charts.timescale.com"),
			},
			Values: pulumi.Map{
				"replicaCount": pulumi.Int(2),
				"loadBalancer": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				"prometheus": pulumi.Map{
					"enabled": pulumi.Bool(true),
				},
				"rbac": pulumi.Map{
					"create": pulumi.Bool(true),
				},
				"secretNames": pulumi.Map{
					"certificate": pulumi.String("timescale-tls"),
					"credentials": pulumi.String("timescale-credentials"),
				},
				"backup": pulumi.Map{
					"enabled": pulumi.Bool(true),
					"pgBackRest": pulumi.Map{
						"repo1-path":          pulumi.String("/timescalebackups"),
						"repo1-s3-endpoint":   pulumi.String("minio.minio"),
						"repo1-s3-host":       pulumi.String("minio.minio"),
						"repo1-s3-verify-tls": pulumi.String("n"),
					},
					"envFrom": pulumi.MapArray{
						pulumi.Map{
							"secretRef": pulumi.StringMap{
								"name": pulumi.String("timescale-pgbackrest"),
							},
						},
					},
				},
				"persistentVolumes": pulumi.Map{
					"data": pulumi.Map{
						"enabled":      pulumi.Bool(true),
						"size":         pulumi.String("50Gi"),
						"storageClass": pulumi.String("ssd"),
					},
					"wal": pulumi.Map{
						"enabled":      pulumi.Bool(true),
						"size":         pulumi.String("10Gi"),
						"storageClass": pulumi.String("ssd"),
					},
				},
			},
		}, pulumi.DependsOn([]pulumi.Resource{timescaleTls}), pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		corev1.NewSecret(ctx, "promscale-credentials", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("promscale-timescaledb-passwords"),
			},
			StringData: pulumi.StringMap{
				"postgres": pulumi.String(c.Require("patroni_superuser_password")),
			},
		}, pulumi.Provider(k8sProvider))

		_, err = helm.NewChart(ctx, "promscale", helm.ChartArgs{
			Namespace: pulumi.String("timescale"),
			Chart:     pulumi.String("promscale"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://charts.timescale.com"),
			},
			Values: pulumi.Map{
				"connection": pulumi.Map{
					"host": pulumi.Map{
						"nameTemplate": pulumi.String("timescale.timescale"),
					},
					"dbName": pulumi.String("postgres"),
				},
				"service": pulumi.Map{
					"loadBalancer": pulumi.Map{
						"enabled": pulumi.Bool(false),
					},
				},
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// -------- PROMETHEUS --------
		ns, err = corev1.NewNamespace(ctx, "monitoring", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("monitoring"),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = helm.NewChart(ctx, "prometheus", helm.ChartArgs{
			Namespace: pulumi.String("monitoring"),
			Chart:     pulumi.String("prometheus"),
			Repo:      pulumi.String("stable"),
			Values: pulumi.Map{
				"alertmanager": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				"pushgateway": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				"extraScrapeConfigs": pulumi.String(`
remote_write:
  - url: "http://promscale-connector.timescale:9201/write"
remote_read:
  - url: "http://promscale-connector.timescale:9201/read"`),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// -------- GRAFANA --------
		corev1.NewSecret(ctx, "grafana-credentials", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("grafana-credentials"),
			},
			StringData: pulumi.StringMap{
				"GF_DATABASE_TYPE":     pulumi.String("postgres"),
				"GF_DATABASE_HOST":     pulumi.String("timescale.timescale"),
				"GF_DATABASE_USER":     pulumi.String("postgres"),
				"GF_DATABASE_NAME":     pulumi.String("postgres"),
				"GF_DATABASE_SSL_MODE": pulumi.String("require"),
				"GF_DATABASE_PASSWORD": pulumi.String(c.Require("patroni_superuser_password")),
			},
		}, pulumi.Provider(k8sProvider))

		_, err = helm.NewChart(ctx, "grafana", helm.ChartArgs{
			Namespace: pulumi.String("monitoring"),
			Chart:     pulumi.String("grafana"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://grafana.github.io/helm-charts"),
			},
			Values: pulumi.Map{
				"envFromSecret": pulumi.String("grafana-credentials"),
				"adminUser":     pulumi.String("admin"),
				"adminPassword": pulumi.String(c.Require("grafana-admin-pass")),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		// -------- LOKI --------
		sa, err = serviceaccount.NewAccount(ctx, "loki", &serviceaccount.AccountArgs{
			AccountId: pulumi.String("lokilogs"),
		})
		if err != nil {
			return err
		}
		_, err = projects.NewIAMBinding(ctx, "loki-storage-admin-binding", &projects.IAMBindingArgs{
			Members: pulumi.StringArray{pulumi.Sprintf("serviceAccount:%s", sa.Email)},
			Role:    pulumi.String("roles/storage.objectAdmin"),
		})
		if err != nil {
			return err
		}
		key, err = serviceaccount.NewKey(ctx, "loki-gcs", &serviceaccount.KeyArgs{
			ServiceAccountId: sa.ID(),
		})
		if err != nil {
			return err
		}

		secret, err := corev1.NewSecret(ctx, "loki-credentials", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("loki-credentials"),
			},
			StringData: pulumi.StringMap{
				"gcsKeyJson": key.PrivateKey.ApplyString(func(s string) string {
					str, _ := base64.StdEncoding.DecodeString(s)
					return string(str)
				}),
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		bucket, err = storage.NewBucket(ctx, "lokilogs", &storage.BucketArgs{
			Name:     pulumi.String("lokilogs"),
			Location: pulumi.String(config.Get(ctx, "gcp:region")),
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		_, err = helm.NewChart(ctx, "loki", helm.ChartArgs{
			Namespace: pulumi.String("monitoring"),
			Chart:     pulumi.String("loki"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://grafana.github.io/loki/charts"),
			},
			Version: pulumi.String("2.0.2"),
			Values: pulumi.Map{
				"storage_config": pulumi.Map{
					"boltdb_shipper": pulumi.Map{
						"shared_store": pulumi.String("gcs"),
					},
					"gcs": pulumi.Map{
						"bucket_name": bucket.Name,
					},
				},
				"schema_config": pulumi.Map{
					"configs": pulumi.MapArray{
						pulumi.Map{
							"configs": pulumi.Map{
								"store":        pulumi.String("boltdb-shipper"),
								"object_store": pulumi.String("gcs"),
								"schema":       pulumi.String("v11"),
								"index": pulumi.Map{
									"prefix": pulumi.String("index_"),
									"period": pulumi.String("24h"),
								},
							},
						},
					},
				},
				"env": pulumi.MapArray{
					pulumi.Map{
						"name": pulumi.String("GOOGLE_APPLICATION_CREDENTIALS"),
						"valueFrom": pulumi.Map{
							"secretKeyRef": pulumi.Map{
								"name": secret.Metadata.Name(),
								"key":  pulumi.String("gcsKeyJson"),
							},
						},
					},
				},
			},
		}, pulumi.Provider(k8sProvider))
		if err != nil {
			return err
		}

		return nil
	})
}

func generateKubeconfig(cluster *container.Cluster) pulumi.StringOutput {
	context := pulumi.Sprintf("demo_%s", cluster.Name)
	return pulumi.Sprintf(`apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: %s
    server: https://%s
  name: %s
contexts:
- context:
    cluster: %s
    user: %s
  name: %s
current-context: %s
kind: Config
preferences: {}
users:
- name: %s
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp`,
		cluster.MasterAuth.ClusterCaCertificate().Elem(),
		cluster.Endpoint, context, context, context, context, context, context)
}
