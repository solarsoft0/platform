import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";  
import { provider } from '../cluster';
import { namespace } from '../monitoring';
import * as YAML from 'yamljs';

const conf = new pulumi.Config("gcp");

export const serviceAccount = new gcp.serviceaccount.Account("loki", {
  accountId: "lokilogs",
  project: conf.require("project"),
});

export const serviceAccountBinding = new gcp.projects.IAMBinding("loki-storage-admin-binding", {
  members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
  role: "roles/storage.objectAdmin",
  project: conf.require("project"),
}, { dependsOn: serviceAccount });

export const serviceAccountKey = new gcp.serviceaccount.Key("loki-gcs", {
  serviceAccountId: serviceAccount.id,
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

export const bucket = new gcp.storage.Bucket("loki-bucket", {
  location: conf.require("region"),
  project: conf.require("project"),
});

export const chart = new k8s.helm.v3.Chart(
  "loki",
  {
    namespace: namespace.metadata.name,
    chart: "loki",
    version: "2.0.2",
    fetchOpts: { repo: "https://grafana.github.io/loki/charts" },
    values: {
      config: {
        auth_enabled: false,
        server: {
          http_listen_port: 3100
        },
        distributor: {
          ring: {
            kvstore: {
              store: "memberlist"
            }
          }
        },
        ingester: {
          lifecycler: {
            ring: {
              kvstore: {
                store: "memberlist"
              },
              replication_factor: 1
            },
            final_sleep: "0s"
          },
          chunk_idle_period: "5m",
          chunk_retain_period: "30s"
        },
        schema_config: {
          configs: [
            {
              from: "2020-05-15",
              store: "boltdb-shipper",
              object_store: "gcs",
              schema: "v11",
              index: {
                prefix: "index_",
                period: "24h"
              }
            }
          ]
        },
        storage_config: {
          boltdb_shipper: {
            active_index_directory: "/data/index",
            cache_location: "/data/index_cache",
            resync_interval: "5s",
            shared_store: "gcs"
          },
          gcs: {
            bucket_name: bucket.name,
          }
        },
        limits_config: {
          enforce_metric_name: false,
          reject_old_samples: true,
          reject_old_samples_max_age: "168h"
        },
      },
      env: [
        {
          name: "GOOGLE_APPLICATION_CREDENTIALS",
          value: '/creds/google'
        }
      ],
      extraVolumes: [
        {
          name: 'google-creds',
          secret: {
            secretName: creds.metadata.name,
            items: [
              {
                key: 'gcsKeyJson',
                path: 'google',
              }
            ]
          },
        },
      ],
      extraVolumeMounts: [
        {
          name: 'google-creds',
          mountPath: '/creds',
          readOnly: true,
        },
      ]
    },
  },
  { provider }
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