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
