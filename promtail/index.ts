import * as k8s from "@pulumi/kubernetes";
import { provider } from '../cluster';
import { namespace } from '../monitoring';

export const chart = new k8s.helm.v3.Chart(
  "promtail",
  {
    namespace: namespace.metadata.name,
    chart: "promtail",
    fetchOpts: {
      repo: "https://grafana.github.io/loki/charts",
        version: "2.0.1",
    },
    values: {
      loki: {
        serviceName: "loki",
        servicePort: 3100,
      },
    }
  },
  { provider },
);
