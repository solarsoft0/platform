import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import certmanager, { caCerts } from "../certmanager";
import * as crd from "../crd";

export const namespace = new k8s.core.v1.Namespace(
  "etcd",
  { metadata: { name: "etcd", labels: { prometheus: "infra" } } },
  { provider }
);

export const serverTLS = new crd.certmanager.v1.Certificate(
  "etcdcerts",
  {
    metadata: {
      name: "etcd",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "etcd-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "etcd",
      dnsNames: [
        "etcd.etcd.svc.cluster.local",
        "*.etcd-headless.etcd.svc.cluster.local",
        "etcd",
        "etcd.etcd"
      ],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider, dependsOn: certmanager }
);

export const clientTLS = new crd.certmanager.v1.Certificate(
  "etcd-client-cert",
  {
    metadata: {
      name: "etcd",
      namespace: "server"
    },
    spec: {
      secretName: "etcd-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      commonName: "etcd",
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider, dependsOn: certmanager }
);

export const chart = new k8s.helm.v3.Chart(
  "etcd",
  {
    namespace: namespace.metadata.name,
    chart: "etcd",
    version: "4.12.2",
    fetchOpts: { repo: "https://charts.bitnami.com/bitnami" },
    values: {
      statefulset: { replicaCount: 3 },
      readinessProbe: { enabled: false },
      livenessProbe: { enabled: false },
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          selector: { prometheus: "infra" },
          scheme: "https",
          tlsConfig: {
            serverName: "etcd",
            ca: {
              secret: {
                name: (serverTLS.spec as any).secretName,
                key: "ca.crt"
              }
            },
            cert: {
              secret: {
                name: (serverTLS.spec as any).secretName,
                key: "tls.crt"
              }
            },
            keySecret: {
              name: (serverTLS.spec as any).secretName,
              key: "tls.key"
            }
          }
        }
      },
      auth: {
        rbac: { enabled: false },
        client: {
          secureTransport: true,
          enableAuthentication: true,
          existingSecret: (serverTLS.spec as any).secretName,
          certFilename: "tls.crt",
          certKeyFilename: "tls.key",
          caFilename: "ca.crt"
        },
        peer: {
          secureTransport: true,
          enableAuthentication: true,
          existingSecret: (serverTLS.spec as any).secretName,
          certFilename: "tls.crt",
          certKeyFilename: "tls.key",
          caFilename: "ca.crt"
        }
      }
    }
  },
  { provider, dependsOn: [caCerts, namespace] }
);

export default [namespace, serverTLS, clientTLS, chart];
