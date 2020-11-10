import * as k8s from "@pulumi/kubernetes";
import { provider } from '../cluster';
import { namespace } from '../monitoring';
import promscale from '../promscale';

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
