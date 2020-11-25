import * as k8s from "@pulumi/kubernetes";
import { letsEncryptCerts } from "../certmanager";
import { provider } from "../cluster";
import { namespace } from "../monitoring";
import * as YAML from "yamljs";

const alertmanagerUrls = ["alerts.internal.production.m3o.com"];
const promUrls = ["prom.internal.production.m3o.com"];

export const chart = new k8s.helm.v3.Chart(
  "prometheus",
  {
    namespace: namespace.metadata.name,
    chart: "prometheus",
    fetchOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    values: {
      alertmanager: {
        replicaCount: 2,
        statefulSet: { enabled: true, headless: { enableMeshPeer: true } },
        baseURL: "https://" + alertmanagerUrls[0],
        ingress: {
          enabled: true,
          annotations: {
            "kubernetes.io/ingress.class": "internal",
            "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as any)
              .name!
          },
          hosts: alertmanagerUrls,
          tls: [{ secretName: "alertmanager-tls", hosts: alertmanagerUrls }],
          service: {
            gRPC: { enabled: true }
          }
        }
      },
      server: {
        remoteWrite: [
          {
            url: "http://promscale-connector:9201/write",
            name: "promscale"
          }
        ],
        ingress: {
          enabled: true,
          annotations: {
            "kubernetes.io/ingress.class": "internal",
            "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as any)
              .name!
          },
          hosts: promUrls,
          tls: [{ secretName: "prom-tls", hosts: promUrls }]
        },
        persistentVolume: {
          size: "40Gi"
        },
        replicaCount: 1,
        statefulSet: { enabled: true },
        service: {
          gRPC: { enabled: true }
        },
        baseURL: "https://" + promUrls[0]
      },
      extraScrapeConfigs: YAML.stringify([
        {
          job_name: "kubernetes-service-endpoints",
          tls_config: { insecure_skip_verify: true },
          kubernetes_sd_configs: [
            {
              role: "endpoints"
            }
          ],
          relabel_configs: [
            {
              source_labels: [
                "__meta_kubernetes_service_annotation_prometheus_io_scrape"
              ],
              action: "keep",
              regex: true
            },
            {
              source_labels: [
                "__meta_kubernetes_service_annotation_prometheus_io_scheme"
              ],
              action: "replace",
              target_label: "__scheme__",
              regex: "(https?)"
            },
            {
              source_labels: [
                "__meta_kubernetes_service_annotation_prometheus_io_path"
              ],
              action: "replace",
              target_label: "__metrics_path__",
              regex: "(.+)"
            },
            {
              source_labels: [
                "__address__",
                "__meta_kubernetes_service_annotation_prometheus_io_port"
              ],
              action: "replace",
              target_label: "__address__",
              regex: "([^:]+)(?::\\d+)?;(\\d+)",
              replacement: "$1:$2"
            },
            {
              action: "labelmap",
              regex: "__meta_kubernetes_service_label_(.+)"
            },
            {
              source_labels: ["__meta_kubernetes_namespace"],
              action: "replace",
              target_label: "kubernetes_namespace"
            },
            {
              source_labels: ["__meta_kubernetes_service_name"],
              action: "replace",
              target_label: "kubernetes_name"
            },
            {
              source_labels: ["__meta_kubernetes_pod_node_name"],
              action: "replace",
              target_label: "kubernetes_node"
            }
          ]
        }
      ])
    }
  },
  { provider }
);

const datasource = YAML.stringify({
  apiVersion: 1,
  datasources: [
    {
      name: "Prometheus (Infrastructure)",
      type: "prometheus",
      access: "proxy",
      url: "http://prometheus-server",
      isDefault: true,
      editable: true
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
