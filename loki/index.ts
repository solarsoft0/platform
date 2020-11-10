import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";  
import { provider } from '../cluster';
import { namespace } from '../monitoring';
import * as YAML from 'yamljs';

const conf = new pulumi.Config("gcp");

// -------- LOKI --------
export const serviceAccount = new gcp.serviceaccount.Account("loki", {
  accountId: "lokilogs"
});

export const serviceAccountBinding = new gcp.projects.IAMBinding("loki-storage-admin-binding", {
  members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
  role: "roles/storage.objectAdmin"
}, { dependsOn: serviceAccount });

export const serviceAccountKey = new gcp.serviceaccount.Key("loki-gcs", {
  serviceAccountId: serviceAccount.id
});

export const creds = new k8s.core.v1.Secret(
  "loki-credentials",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "loki-credentials"
    },
    stringData: {
      gcsKeyJson: serviceAccountKey.privateKey.apply((s: string) => {
        let buff = new Buffer(s, "base64");
        return buff.toString("ascii");
      })
    }
  },
  { provider }
);

export const bucket = new gcp.storage.Bucket("lokilogs", {
  location: conf.require("region")
});

export const chart = new k8s.helm.v3.Chart(
  "loki",
  {
    namespace: namespace.metadata.name,
    chart: "loki",
    version: "2.0.2",
    fetchOpts: { repo: "https://grafana.github.io/loki/charts" },
    values: {
      storage_config: {
        boltdb_shipper: {
          shared_store: "gcs"
        },
        gcs: {
          bucket_name: bucket.name
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
              name: creds.metadata.name,
              key: "gcsKeyJson"
            }
          }
        }
      ]
    }
  },
  { provider, dependsOn: [serviceAccountBinding] }
);

const datasource = YAML.stringify({
  apiVersion: 1,
  datasources: [
    {
      name: "Loki",
      type: "loki",
      access: "proxy",
      url: "loki:3100",
      version: 1,
    },
  ],
});

export const configMap = new k8s.core.v1.ConfigMap(
  "loki-grafana",
  {
    metadata: {
      name: "loki-grafana",
      namespace: namespace.metadata.name,
      labels: {
        app: "loki",
        grafana_datasource: "1",
      },
    },
    data: {
      "loki-datasource.yaml": datasource,
    },
  },
  { provider, dependsOn: chart },
);

export default [
  serviceAccount,
  serviceAccountBinding,
  serviceAccountKey,
  creds,
  bucket,
  chart,
  configMap,
]