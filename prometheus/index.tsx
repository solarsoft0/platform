import * as k8s from "@pulumi/kubernetes";
import { provider } from '../cluster';
import { namespace } from '../monitoring';
import promscale from '../promscale';
import * as YAML from 'yamljs';

export const chart = new k8s.helm.v3.Chart(
  "prometheus",
  {
    namespace: namespace.metadata.name,
    chart: "prometheus",
    repo: "stable",
    values: {
      alertmanager: { enabled: false },
      pushgateway: { enabled: false },
      extraScrapeConfigs: `
remote_write:
  - url: "http://promscale-connector.monitoring:9201/write"
remote_read:
  - url: "http://promscale-connector.monitoring:9201/read"`
    }
  },
  { provider, dependsOn: promscale },
);

const datasource = YAML.stringify({
  apiVersion: 1,
  datasources: [
    {
      name: "Prometheus",
      type: "prometheus",
      access: "proxy",
      url: "http://prometheus-server",
    },
  ],
});

export const configMap = new k8s.core.v1.ConfigMap(
  "prometheus-grafana",
  {
    metadata: {
      name: "prometheus-grafana",
      namespace: namespace.metadata.name,
      labels: {
        app: "prometheus",
        grafana_datasource: "1",
      },
    },
    data: {
      "prometheus-datasource.yaml": datasource,
    },
  },
  { provider, dependsOn: chart },
);

export default [
  chart,
  configMap,
];