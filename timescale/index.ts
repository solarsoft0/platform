import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";  
import { provider } from '../cluster';

const cf = new pulumi.Config("dply");
const gcpConf = new pulumi.Config("gcp");

export const namespace = new k8s.core.v1.Namespace(
  "timescale",
  { metadata: { name: "timescale" } },
  { provider }
);

export const tls = new k8s.yaml.ConfigFile(
  "timescale-tls",
  { file: "timescale/certs.yml" },
  { provider, dependsOn: namespace }
);

export const bucket = new gcp.storage.Bucket("timescalebackups", {
  location: gcpConf.require("region")
});

export const creds = new k8s.core.v1.Secret(
  "timescale-credentials",
  {
    metadata: {
      namespace: namespace.metadata.name
    },
    stringData: {
      PATRONI_SUPERUSER_PASSWORD: cf.require("patroni_superuser_password"),
      PATRONI_REPLICATION_PASSWORD: cf.require("patroni_replication_password"),
      PATRONI_admin_PASSWORD: cf.require("patroni_admin_password")
    }
  },
  { provider }
);

export const pgBackrest = new k8s.core.v1.Secret(
  "timescale-pgbackrest",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "timescale-pgbackrest"
    },
    stringData: {
      PGBACKREST_REPO1_S3_BUCKET: bucket.name,
      PGBACKREST_REPO1_S3_REGION: gcpConf.require("region"),
      PGBACKREST_REPO1_S3_KEY: cf.require("minio-access-key"),
      PGBACKREST_REPO1_S3_KEY_SECRET: cf.require("minio-secret-key")
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "timescale",
  {
    namespace: namespace.metadata.name,
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
        credentials: creds.metadata.name,
        certificate: "timescale-tls"
      },
      backup: {
        enabled: true,
        pgBackRest: {
          "repo1-path": pulumi.interpolate`/${bucket.name}`,
          "repo1-s3-endpoint": "minio.minio",
          "repo1-s3-host": "minio.minio",
          "repo1-s3-verify-tls": "n"
        },
        envFrom: [
          {
            secretRef: {
              name: pgBackrest.metadata.name
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
  { provider }
);

export default [
  namespace,
  tls,
  bucket,
  creds,
  pgBackrest,
  chart,
]