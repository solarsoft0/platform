import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { provider } from '../cluster';
import { caCerts } from '../certmanager';

export const namespace = new k8s.core.v1.Namespace(
  "etcd",
  { metadata: { name: "etcd" } },
  { provider }
);

export const certs = new k8s.yaml.ConfigFile(
  "etcdcerts",
  { file: "etcd/certs.yml" },
  { provider, dependsOn: [caCerts, namespace] }
);

export const chart = new k8s.helm.v3.Chart(
  "etcd",
  {
    namespace: namespace.metadata.name,
    chart: "etcd",
    version: "4.12.2",
    fetchOpts: { repo: "https://charts.bitnami.com/bitnami" },
    values: {
      statefulset: { replicaCount: 1 },
      readinessProbe: { enabled: false },
      livenessProbe: { enabled: false },
      metrics: { enabled: true },
      auth: {
        rbac: { enabled: false },
        client: {
          secureTransport: true,
          enableAuthentication: true,
          existingSecret: "etcd-client-certs",
          certFilename: "tls.crt",
          certKeyFilename: "tls.key",
          caFilename: "ca.crt"
        },
        peer: {
          secureTransport: true,
          enableAuthentication: true,
          existingSecret: "etcd-peer-certs",
          certFilename: "tls.crt",
          certKeyFilename: "tls.key",
          caFilename: "ca.crt"
        }
      }
    }
  },
  { provider, dependsOn: [caCerts, namespace] }
);

export default [
  namespace,
  certs,
  chart,
]