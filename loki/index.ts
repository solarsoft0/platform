import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";  
import { provider } from '../cluster';
import { namespace } from '../monitoring';
import * as YAML from 'yamljs';
import * as ocean from "@pulumi/digitalocean";
import { project } from "../cluster";

const conf = new pulumi.Config("digitalocean");

export const bucket = new ocean.SpacesBucket("loki-logs", {
  region: "ams3",
}, {
  parent: project,
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
        aws: {
          endpoint: "ams3.digitaloceanspaces.com",
          region: bucket.region,
          access_key_id: conf.require("spacesAccessId"),
          secret_access_key: conf.require("spacesSecretKey"),
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
  bucket,
  chart,
  configMap,
]