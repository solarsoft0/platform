import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { K8SExec } from "./exec";

const network = new gcp.compute.Network("stagpriv", {
  autoCreateSubnetworks: true
});

// Create the GKE cluster and export it.
const k8sCluster = new gcp.container.Cluster("m3ocluster", {
  initialNodeCount: 1,
  removeDefaultNodePool: true,
  network: network.name,
  networkingMode: "VPC_NATIVE",
  enableShieldedNodes: true,
  loggingService: "none",
  monitoringService: "none",
  releaseChannel: { channel: "STABLE" },
  networkPolicy: { enabled: true },
  addonsConfig: { httpLoadBalancing: { disabled: true } },
  ipAllocationPolicy: { clusterIpv4CidrBlock: "", servicesIpv4CidrBlock: "" }
});

const nodePool = new gcp.container.NodePool("micro", {
  cluster: k8sCluster.name,
  nodeCount: 1,
  autoscaling: { minNodeCount: 1, maxNodeCount: 3 },
  nodeConfig: { preemptible: true, machineType: "e2-standard-2" }
});

// Manufacture a GKE-style Kubeconfig. Note that this is slightly "different" because of the way GKE requires
// gcloud to be in the picture for cluster authentication (rather than using the client cert/key directly).
const k8sConfig = pulumi
  .all([k8sCluster.name, k8sCluster.endpoint, k8sCluster.masterAuth])
  .apply(([name, endpoint, auth]) => {
    const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
    return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
  });

const k8sProvider = new k8s.Provider(
  "gkeK8s",
  {
    kubeconfig: k8sConfig
  },
  {
    dependsOn: [nodePool]
  }
);

const cf = new pulumi.Config("dply");
const gcpConf = new pulumi.Config("gcp");

new k8s.storage.v1.StorageClass(
  "ssd",
  {
    allowVolumeExpansion: true,
    parameters: { type: "pd-ssd" },
    metadata: { name: "ssd" },
    provisioner: "kubernetes.io/gce-pd"
  },
  { provider: k8sProvider }
);

const cnNs = new k8s.core.v1.Namespace(
  "cert-manager",
  { metadata: { name: "cert-manager" } },
  { provider: k8sProvider }
);

const cfSecret = new k8s.core.v1.Secret(
  "cloudflare-api-key",
  {
    metadata: { namespace: cnNs.metadata.name, name: "cloudflare-api-key" },
    stringData: { cloudflare: cf.require("cloudflare-api-key") }
  },
  { provider: k8sProvider }
);

const cfChart = new k8s.helm.v3.Chart(
  "certmanager",
  {
    namespace: cnNs.metadata.name,
    chart: "cert-manager",
    version: "v1.0.3",
    fetchOpts: { repo: "https://charts.jetstack.io" },
    values: { installCRDs: true }
  },
  { provider: k8sProvider, dependsOn: cfSecret }
);

new k8s.yaml.ConfigFile(
  "letsencryptcerts",
  { file: "issueracme.yaml" },
  { provider: k8sProvider, dependsOn: cfChart }
);

new k8s.core.v1.Secret(
  "ca",
  {
    metadata: {
      namespace: cnNs.metadata.name,
      name: "ca"
    },
    stringData: {
      "tls.crt": cf.require("ca-crt"),
      "tls.key": cf.require("ca-key")
    }
  },
  { provider: k8sProvider, dependsOn: cfChart }
);

const caCerts = new k8s.yaml.ConfigFile(
  "cacerts",
  { file: "issuercustomca.yaml" },
  { provider: k8sProvider, dependsOn: cfChart }
);

// ---------ETCD----------
const etcdNs = new k8s.core.v1.Namespace(
  "etcd",
  { metadata: { name: "etcd" } },
  { provider: k8sProvider }
);

new k8s.yaml.ConfigFile(
  "etcdcerts",
  { file: "etcd/certs.yml" },
  { provider: k8sProvider, dependsOn: [caCerts, etcdNs] }
);

new k8s.helm.v3.Chart(
  "etcd",
  {
    namespace: etcdNs.metadata.name,
    chart: "etcd",
    version: "4.12.2",
    fetchOpts: { repo: "https://charts.bitnami.com/bitnami" },
    values: {
      statefulset: { replicaCount: 1 },
      readinessProbe: { enabled: false },
      livenessProbe: { enabled: false },
      metrics: { enabled: true },
      auth: {
        rbac: { enabled: false },
        client: {
          secureTransport: true,
          enableAuthentication: true,
          existingSecret: "etcd-client-certs",
          certFilename: "tls.crt",
          certKeyFilename: "tls.key",
          caFilename: "ca.crt"
        },
        peer: {
          secureTransport: true,
          enableAuthentication: true,
          existingSecret: "etcd-peer-certs",
          certFilename: "tls.crt",
          certKeyFilename: "tls.key",
          caFilename: "ca.crt"
        }
      }
    }
  },
  { provider: k8sProvider, dependsOn: [caCerts, etcdNs] }
);

// ---------MINIO----------
const minioNs = new k8s.core.v1.Namespace(
  "minio",
  { metadata: { name: "minio" } },
  { provider: k8sProvider }
);

new k8s.yaml.ConfigFile(
  "miniocerts",
  { file: "minio/certs.yml" },
  { provider: k8sProvider, dependsOn: minioNs }
);

const msa = new gcp.serviceaccount.Account("minio", {
  accountId: "miniostorage"
});

new gcp.projects.IAMBinding("minio-storage-admin-binding", {
  members: [pulumi.interpolate`serviceAccount:${msa.email}`],
  role: "roles/storage.admin"
});

const minioKey = new gcp.serviceaccount.Key("minio-gcs", {
  serviceAccountId: msa.id
});

new k8s.helm.v3.Chart(
  "minio",
  {
    namespace: minioNs.metadata.name,
    chart: "minio",
    version: "8.0.0",
    fetchOpts: { repo: "https://helm.min.io/" },
    values: {
      service: { port: "443" },
      tls: {
        enabled: true,
        certSecret: "minio-tls",
        publicCrt: "tls.crt",
        privateKey: "tls.key"
      },
      persistence: { enabled: false },
      gcsgateway: {
        replicas: 1,
        enabled: true,
        projectId: gcpConf.require("project"),
        gcsKeyJson: minioKey.privateKey.apply(s => {
          let buff = new Buffer(s, "base64");
          return buff.toString("ascii");
        })
      },
      accessKey: cf.require("minio-access-key"),
      secretKey: cf.require("minio-secret-key"),
      resources: { requests: { memory: 256 } }
    }
  },
  { provider: k8sProvider }
);

// -------- Timescaledb ----------

const tsNs = new k8s.core.v1.Namespace(
  "timescale",
  { metadata: { name: "timescale" } },
  { provider: k8sProvider }
);

const tsBucket = new gcp.storage.Bucket("timescalebackups", {
  location: gcpConf.require("region")
});

const timescaleCreds = new k8s.core.v1.Secret(
  "timescale-credentials",
  {
    metadata: {
      namespace: tsNs.metadata.name
    },
    stringData: {
      PATRONI_SUPERUSER_PASSWORD: cf.require("patroni_superuser_password"),
      PATRONI_REPLICATION_PASSWORD: cf.require("patroni_replication_password"),
      PATRONI_admin_PASSWORD: cf.require("patroni_admin_password")
    }
  },
  { provider: k8sProvider }
);

const timescalePgBackrest = new k8s.core.v1.Secret(
  "timescale-pgbackrest",
  {
    metadata: {
      namespace: tsNs.metadata.name,
      name: "timescale-pgbackrest"
    },
    stringData: {
      PGBACKREST_REPO1_S3_BUCKET: tsBucket.name,
      PGBACKREST_REPO1_S3_REGION: gcpConf.require("region"),
      PGBACKREST_REPO1_S3_KEY: cf.require("minio-access-key"),
      PGBACKREST_REPO1_S3_KEY_SECRET: cf.require("minio-secret-key")
    }
  },
  { provider: k8sProvider }
);

new k8s.yaml.ConfigFile(
  "timescale-tls",
  { file: "timescale/certs.yml" },
  { provider: k8sProvider, dependsOn: tsNs }
);

const tsChart = new k8s.helm.v3.Chart(
  "timescale",
  {
    namespace: tsNs.metadata.name,
    chart: "timescaledb-single",
    fetchOpts: { repo: "https://charts.timescale.com" },
    values: {
      image: { tag: "pg12.4-ts1.7.4-p1" },
      replicaCount: 2,
      loadBalancer: {
        enabled: true
      },
      prometheus: { enabled: false },
      rbac: {
        enabled: true
      },
      secretNames: {
        credentials: timescaleCreds.metadata.name,
        certificate: "timescale-tls"
      },
      backup: {
        enabled: true,
        pgBackRest: {
          "repo1-path": pulumi.interpolate`/${tsBucket.name}`,
          "repo1-s3-endpoint": "minio.minio",
          "repo1-s3-host": "minio.minio",
          "repo1-s3-verify-tls": "n"
        },
        envFrom: [
          {
            secretRef: {
              name: timescalePgBackrest.metadata.name
            }
          }
        ]
      },
      persistentVolumes: {
        data: {
          enabled: true,
          size: "50Gi",
          storageClass: "ssd"
        },
        wal: {
          enabled: true,
          size: "10Gi",
          storageClass: "ssd"
        }
      }
    }
  },
  { provider: k8sProvider }
);

new K8SExec(
  "promscale-db",
  {
    namespace: tsNs.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: k8sConfig,
    cmd: ["psql", "-c", "CREATE DATABASE analytics;"]
  },
  { dependsOn: tsChart }
);

new K8SExec(
  "promscale-user",
  {
    namespace: tsNs.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: k8sConfig,
    cmd: [
      "psql",
      "-c",
      `create user promscale with password '${cf
        .require("promscale_postgres_password")
        .toString()}' SUPERUSER;`
    ]
  },
  { dependsOn: tsChart }
);

new K8SExec(
  "promscale-grant",
  {
    namespace: tsNs.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: k8sConfig,
    cmd: [
      "psql",
      "-c",
      `GRANT ALL PRIVILEGES ON DATABASE analytics TO promscale`
    ]
  },
  { dependsOn: tsChart }
);

new k8s.core.v1.Secret(
  "promscale-credentials",
  {
    metadata: {
      namespace: tsNs.metadata.name,
      name: "promscale-timescaledb-passwords"
    },
    stringData: {
      promscale: cf.require("promscale_postgres_password")
    }
  },
  { provider: k8sProvider }
);

new k8s.helm.v3.Chart(
  "promscale",
  {
    namespace: tsNs.metadata.name,
    chart: "promscale",
    fetchOpts: { repo: "https://charts.timescale.com" },
    values: {
      image: "timescale/promscale:0.1.2",
      connection: {
        user: "promscale",
        host: { nameTemplate: "timescale.timescale" },
        password: { secretTemplate: "promscale-timescaledb-passwords" },
        dbName: "analytics"
      },
      service: {
        loadBalancer: { enabled: false }
      }
    }
  },
  { provider: k8sProvider }
);

// -------- GRAFANA --------
const monNs = new k8s.core.v1.Namespace(
  "monitoring",
  { metadata: { name: "monitoring" } },
  { provider: k8sProvider }
);

const grafanaCreds = new k8s.core.v1.Secret(
  "grafana-credentials",
  {
    metadata: {
      namespace: monNs.metadata.name,
      name: "grafana-credentials"
    },
    stringData: {
      GF_DATABASE_TYPE: "postgres",
      GF_DATABASE_HOST: "timescale.timescale",
      GF_DATABASE_USER: "postgres",
      GF_DATABASE_NAME: "postgres",
      GF_DATABASE_SSL_MODE: "require",
      GF_DATABASE_PASSWORD: cf.require("patroni_superuser_password")
    }
  },
  { provider: k8sProvider }
);

new k8s.helm.v3.Chart(
  "grafana",
  {
    namespace: monNs.metadata.name,
    chart: "grafana",
    fetchOpts: { repo: "https://grafana.github.io/helm-charts" },
    values: {
      envFromSecret: grafanaCreds.metadata.name,
      adminUser: "admin",
      adminPassword: cf.require("grafana-admin-pass")
    }
  },
  { provider: k8sProvider }
);

// -------- LOKI --------
const lsa = new gcp.serviceaccount.Account("loki", {
  accountId: "lokilogs"
});

new gcp.projects.IAMBinding("loki-storage-admin-binding", {
  members: [pulumi.interpolate`serviceAccount:${lsa.email}`],
  role: "roles/storage.objectAdmin"
});

const lokiKey = new gcp.serviceaccount.Key("loki-gcs", {
  serviceAccountId: lsa.id
});

const lokiCreds = new k8s.core.v1.Secret(
  "loki-credentials",
  {
    metadata: {
      namespace: monNs.metadata.name,
      name: "loki-credentials"
    },
    stringData: {
      gcsKeyJson: lokiKey.privateKey.apply((s: string) => {
        let buff = new Buffer(s, "base64");
        return buff.toString("ascii");
      })
    }
  },
  { provider: k8sProvider }
);

const lokiBucket = new gcp.storage.Bucket("lokilogs", {
  location: gcpConf.require("region")
});

new k8s.helm.v3.Chart(
  "loki",
  {
    namespace: monNs.metadata.name,
    chart: "loki",
    version: "2.0.2",
    fetchOpts: { repo: "https://grafana.github.io/loki/charts" },
    values: {
      storage_config: {
        boltdb_shipper: {
          shared_store: "gcs"
        },
        gcs: {
          bucket_name: lokiBucket.name
        }
      },
      schema_config: {
        configs: [
          {
            configs: {
              store: "boltdb-shipper",
              object_store: "gcs",
              schema: "v11",
              index: {
                prefix: "index_",
                period: "24h"
              }
            }
          }
        ]
      },
      env: [
        {
          name: "GOOGLE_APPLICATION_CREDENTIALS",
          valueFrom: {
            secretKeyRef: {
              name: lokiCreds.metadata.name,
              key: "gcsKeyJson"
            }
          }
        }
      ]
    }
  },
  { provider: k8sProvider }
);

// -------- METABASE --------

new K8SExec(
  "metabase-user",
  {
    namespace: tsNs.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: k8sConfig,
    cmd: [
      "psql",
      "-c",
      `create user ${cf.require('metabase_db_username').toString()} with password '${cf.require("metabase_db_password").toString()}' SUPERUSER;`
    ]
  },
  { dependsOn: tsChart }
);

const mbNs = new k8s.core.v1.Namespace(
  "metabase",
  { metadata: { "name": "metabase" } },
  { provider: k8sProvider },
);

const mbCreds = new k8s.core.v1.Secret(
  "mbCreds",
  {
    metadata: {
      namespace: mbNs.metadata.name,
      name: "metabase-creds"
    },
    stringData: {
      uri: "timescale.timescale:5432/analytics",
      username: cf.require("metabase_db_username"),
      password: cf.require("metabase_db_password"),
    },
  },
  { provider: k8sProvider }
);

new k8s.helm.v3.Chart(
  "metabase",
  {
    namespace: mbNs.metadata.name,
    chart: "metabase",
    repo: "stable",
    values: {
      database: {
        type: "PostgreSQL",
        existingSecret: mbCreds.metadata.name,
        existingSecretUsernameKey: "username",
        existingSecretPasswordKey: "password",
        existingSecretConnectionURIKey: "uri",
      },
    },
  },
  { provider: k8sProvider },
);