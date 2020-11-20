import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import { namespace } from "../monitoring";
import promscale from "../promscale";
import * as YAML from "yamljs";
import * as crd from "../crd";

// export const chart = new k8s.helm.v3.Chart(
//   "prometheus",
//   {
//     namespace: namespace.metadata.name,
//     chart: "prometheus",
//     repo: "stable",
//     values: {
//       alertmanager: { enabled: false },
//       pushgateway: { enabled: false },
//       extraScrapeConfigs: `
// remote_write:
//   - url: "http://promscale-connector.monitoring:9201/write"
// remote_read:
//   - url: "http://promscale-connector.monitoring:9201/read"`
//     }
//   },
//   { provider, dependsOn: promscale },
// );

// Has namespace of monitoring hardcoded
const operator = new k8s.yaml.ConfigFile(
  "prometheus-operator",
  {
    file: "./prometheus/bundle.yaml"
  },
  { provider }
);

const promSA = new k8s.core.v1.ServiceAccount(
  "prometheus-sa",
  {
    metadata: { name: "prometheus", namespace: "monitoring" }
  },
  { provider }
);

const promRBAC = new k8s.rbac.v1.ClusterRole(
  "prometheus-cr",
  {
    metadata: {
      name: "prometheus"
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["nodes", "nodes/metrics", "services", "endpoints", "pods"],
        verbs: ["get", "list", "watch"]
      },
      {
        apiGroups: [""],
        resources: ["configmaps"],
        verbs: ["get"]
      },
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses"],
        verbs: ["get", "list", "watch"]
      },
      {
        nonResourceURLs: ["/metrics"],
        verbs: ["get"]
      }
    ]
  },
  { provider }
);

const promcrb = new k8s.rbac.v1.ClusterRoleBinding(
  "prometheus-crb",
  {
    metadata: {
      name: "prometheus"
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "prometheus"
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "prometheus",
        namespace: "monitoring"
      }
    ]
  },
  { provider }
);

const prom = new crd.monitoring.v1.Prometheus(
  "prometheus-infra",
  {
    metadata: { name: "prometheus-infra", namespace: "monitoring" },
    spec: {
      serviceAccountName: "prometheus",
      serviceMonitorSelector: { matchLabels: { prometheus: "infra" } },
      serviceMonitorNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      retention: "7d",
      storage: {
        volumeClaimTemplate: {
          spec: { resources: { requests: { storage: "40Gi" } } }
        }
      },
      securityContext: {
        fsGroup: 2000,
        runAsNonRoot: true,
        runAsUser: 1000
      }
    }
  },
  { provider, dependsOn: [promSA] }
);

// const datasource = YAML.stringify({
//   apiVersion: 1,
//   datasources: [
//     {
//       name: "Prometheus",
//       type: "prometheus",
//       access: "proxy",
//       url: "http://prometheus-server",
//     },
//   ],
// });

// export const configMap = new k8s.core.v1.ConfigMap(
//   "prometheus-grafana",
//   {
//     metadata: {
//       name: "prometheus-grafana",
//       namespace: namespace.metadata.name,
//       labels: {
//         app: "prometheus",
//         grafana_datasource: "1",
//       },
//     },
//     data: {
//       "prometheus-datasource.yaml": datasource,
//     },
//   },
//   { provider, dependsOn: chart },
// );

export default [
  operator,
  prom,
  promSA,
  promRBAC,
  promcrb

  // configMap,
];
