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
      defaultRules: { create: true },
      prometheusOperator: {
        tls: { enabled: false },
        admissionWebhooks: { enabled: false }
      },
      grafana: {
        enabled: false
      },
      alertmanager: {
        enabled: true
      },
      prometheus: {
        enabled: true,
        prometheusSpec: {
          serviceMonitorNamespaceSelector: { prometheus: "infra" }
        }
      },
      kubeScheduler: { enabled: false },
      kubeEtcd: { enabled: false },
      kubeControllerManager: { enabled: false }
    }
  },
  { provider }
);

const datasource = YAML.stringify({
  apiVersion: 1,
  datasources: [
    {
      name: "Prometheus Infrastructure",
      type: "prometheus",
      access: "proxy",
      url: "http://prom-kube-prometheus-stack-prometheus:9090"
    }
  ]
});

export const configMap = new k8s.core.v1.ConfigMap(
  "prometheus-grafana",
  {
    metadata: {
      name: "prometheus-grafana",
      namespace: namespace.metadata.name,
      labels: {
        app: "prometheus",
        grafana_datasource: "1"
      }
    },
    data: {
      "prometheus-datasource.yaml": datasource
    }
  },
  { provider }
);

export default [];
