import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { letsEncryptCerts } from "../certmanager";
import { provider } from "../cluster";
import { namespace } from "../monitoring";
import * as YAML from "yamljs";
import * as fs from "fs";
import { promisify } from "util";
import { resolve } from "path";

const conf = new pulumi.Config("m3o");

const alertmanagerUrls = ["alerts.internal.production.m3o.com"];
const promUrls = ["prom.internal.production.m3o.com"];

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
async function getFiles(dir: string) {
  const subdirs = await readdir(dir);
  const files: string[] = await Promise.all(
    subdirs.map(async subdir => {
      const res = resolve(dir, subdir);
      return (await stat(res)).isDirectory() ? getFiles(res) : res;
    })
  );
  return files.reduce((a: any, f) => a.concat(f), []);
}

(async function() {
  const files = await getFiles("./prometheus");
  const scrapeConfigs = files
    .map((x: string) => (x.includes("scrape") ? YAML.load(x) : null))
    .filter(Boolean);
  const ruleConfigs = files
    .map((x: string) => (x.includes("rules") ? YAML.load(x) : null))
    .filter(Boolean);
  const alertConfigs = files
    .map((x: string) => (x.includes("alerts") ? YAML.load(x) : null))
    .filter(Boolean);

  new k8s.helm.v3.Chart(
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
          retention: "2d",
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
        serverFiles: {
          "alerting_rules.yml": {
            groups: alertConfigs.map((x: any) => x["groups"]).flat()
          },
          "recording_rules.yml": {
            groups: ruleConfigs.map((x: any) => x["groups"]).flat()
          }
        },
        extraScrapeConfigs: YAML.stringify(
          scrapeConfigs.map((x: any) => x["scrape_configs"]).flat()
        ),
        alertmanagerFiles: {
          "alertmanager.yml": {
            global: { slack_api_url: conf.require("slack-alerts-webhook") },
            receivers: [
              {
                name: "slack",
                slack_configs: [
                  {
                    send_resolved: true,
                    channel: "alerts",
                    username: "Alertmanager",
                    color:
                      '{{ if eq .Status "firing" }}danger{{ else }}good{{ end }}',
                    title:
                      '[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}',
                    text:
                      "{{ with index .Alerts 0 -}}\n  :chart_with_upwards_trend: *<{{ .GeneratorURL }}|Graph>*\n  {{- if .Annotations.runbook }}   :notebook: *<{{ .Annotations.runbook }}|Runbook>*{{ end }}\n{{ end }}\n{{ range .Alerts -}}\n  *Alert:* {{ .Annotations.title }}{{ if .Labels.severity }} - `{{ .Labels.severity }}`{{ end }}\n*Description:* {{ .Annotations.description }} \n*Details:*\n  {{ range .Labels.SortedPairs }} • *{{ .Name }}:* `{{ .Value }}`\n  {{ end }}\n{{ end }}",
                    icon_url:
                      "https://images-na.ssl-images-amazon.com/images/I/614UUp7avTL._AC_UX522_.jpg"
                  }
                ]
              }
            ],
            route: {
              group_by: ["alertname", "job"],
              group_wait: "10s",
              group_interval: "5m",
              receiver: "slack",
              repeat_interval: "3h"
            }
          }
        }
      }
    },
    { provider }
  );
})();

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
