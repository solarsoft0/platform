package main

import (
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/compute"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/container"
	corev1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/core/v1"
	"github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/helm/v3"
	metav1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/meta/v1"
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

		// Cert manager
		ns, err := corev1.NewNamespace(ctx, "cert-manager", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("cert-manager"),
			},
		})
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
		})

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
		})
		if err != nil {
			return err
		}

		// Create a letsencrypt issuer
		_, err = yaml.NewConfigFile(ctx, "letsencryptcerts", &yaml.ConfigFileArgs{
			File: "letsencrypt.yaml",
		})
		if err != nil {
			return err
		}

		// -------- ETCD ----------
		// Cert manager
		ns, err = corev1.NewNamespace(ctx, "etcd", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("etcd"),
			},
		})
		if err != nil {
			return err
		}

		// Root certs for CA
		corev1.NewSecret(ctx, "etcd-ca", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("etcd-ca"),
			},
			StringData: pulumi.StringMap{
				"tls.crt": pulumi.String(c.Require("etcd-ca-crt")),
				"tls.key": pulumi.String(c.Require("etcd-ca-key")),
			},
		})

		_, err = yaml.NewConfigFile(ctx, "etcdissuer", &yaml.ConfigFileArgs{
			File: "etcd/etcdissuer.yml",
		})
		if err != nil {
			return err
		}

		_, err = yaml.NewConfigFile(ctx, "etcdcerts", &yaml.ConfigFileArgs{
			File: "etcd/etcdcerts.yml",
		})
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
					"replicaCount": pulumi.Int(3),
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
		})
		if err != nil {
			return err
		}

		// -------- Timescaledb ----------
		ns, err = corev1.NewNamespace(ctx, "timescale", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("timescale"),
			},
		})
		if err != nil {
			return err
		}

		corev1.NewSecret(ctx, "timescale-ca", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("timescale-ca"),
			},
			StringData: pulumi.StringMap{
				"tls.crt": pulumi.String(c.Require("timescale-ca-crt")),
				"tls.key": pulumi.String(c.Require("timescale-ca-key")),
			},
		})

		corev1.NewSecret(ctx, "timescale-credentials", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("timescale-credentials"),
			},
			StringData: pulumi.StringMap{
				"PATRONI_SUPERUSER_PASSWORD":   pulumi.String(c.Require("patroni_superuser_password")),
				"PATRONI_REPLICATION_PASSWORD": pulumi.String(c.Require("patroni_replication_password")),
				"PATRONI_admin_PASSWORD":       pulumi.String(c.Require("patroni_admin_password")),
			},
		})

		_, err = yaml.NewConfigFile(ctx, "timescale-issuer", &yaml.ConfigFileArgs{
			File: "timescale/issuer.yml",
		})
		if err != nil {
			return err
		}

		_, err = yaml.NewConfigFile(ctx, "timescale-certs", &yaml.ConfigFileArgs{
			File: "timescale/certs.yml",
		})
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
				"networkPolicy": pulumi.Map{
					"enabled":       pulumi.Bool(true),
					"prometheusApp": pulumi.String("prometheus"),
				},
				"backup": pulumi.Map{
					"enabled": pulumi.Bool(false),
				},
				// TODO
				// backups and network policy for analytics
			},
		})
		if err != nil {
			return err
		}

		return nil
	})
}
