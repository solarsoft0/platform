import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import { namespace } from "../monitoring";
import * as YAML from "yamljs";
import * as crd from "../crd";

// One alertmanager is shared amongst N proms
export const alertmanager = new crd.monitoring.v1.Alertmanager(
  "alertmanager",
  {
    metadata: { namespace: "monitoring", name: "alertmanager" },
    spec: { replicas: 2 }
  },
  { provider }
);

export const operatorChart = new k8s.helm.v3.Chart(
  "prom",
  {
    chart: "kube-prometheus-stack",
    fetchOpts: {
      repo: "https://prometheus-community.github.io/helm-charts"
    },
    namespace: namespace.metadata.name,
    values: {
      namespaceOverride: "monitoring",
      defaultRules: { create: false },
      prometheusOperator: {
        tls: { enabled: false },
        admissionWebhooks: { enabled: false }
      },
      grafana: {
        enabled: false
      },
      alertmanager: {
        enabled: false
      },
      prometheus: {
        enabled: false
      },
      kubeScheduler: { enabled: false },
      kubeEtcd: { enabled: false },
      kubeControllerManager: { enabled: false }
    }
  },
  { provider }
);

const prom = new crd.monitoring.v1.Prometheus(
  "prometheus-infra",
  {
    metadata: { name: "prometheus-infra", namespace: "monitoring" },
    spec: {
      alerting: {
        alertmanagers: [
          { namespace: "monitoring", name: "alertmanager", port: "web" }
        ]
      },
      serviceAccountName: "prometheus",
      serviceMonitorSelector: { matchLabels: { prometheus: "infra" } },
      serviceMonitorNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      podMonitorSelector: { matchLabels: { prometheus: "infra" } },
      podMonitorNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      ruleSelector: { matchLabels: { prometheus: "infra" } },
      ruleNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      retention: "1d",
      storage: {
        volumeClaimTemplate: {
          spec: { resources: { requests: { storage: "20Gi" } } }
        }
      },
      securityContext: {
        fsGroup: 2000,
        runAsNonRoot: true,
        runAsUser: 1000
      }
    }
  },
  { provider, dependsOn: [operatorChart] }
);

// export const svc = new k8s.core.v1.Service(
//   "prometheus-infra",
//   {
//     metadata: { namespace: "monitoring", name: "prometheus-infra" },
//     spec: {
//       ports: [
//         {
//           name: "http",
//           port: 80,
//           protocol: "TCP",
//           targetPort: "web"
//         }
//       ],
//       selector: {
//         prometheus: "prometheus-infra"
//       }
//     }
//   },
//   { provider }
// );

// const datasource = YAML.stringify({
//   apiVersion: 1,
//   datasources: [
//     {
//       name: "Prometheus Infrastructure",
//       type: "prometheus",
//       access: "proxy",
//       url: "http://prometheus-infra"
//     }
//   ]
// });

// export const configMap = new k8s.core.v1.ConfigMap(
//   "prometheus-grafana",
//   {
//     metadata: {
//       name: "prometheus-grafana",
//       namespace: namespace.metadata.name,
//       labels: {
//         app: "prometheus",
//         grafana_datasource: "1"
//       }
//     },
//     data: {
//       "prometheus-datasource.yaml": datasource
//     }
//   },
//   { provider }
// );

export default [];
