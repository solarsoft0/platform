import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import { letsEncryptCerts } from "../certmanager";
import { internalChart } from "../nginx";
import { ObjectMeta } from "../crd/meta/v1";
import * as crd from "../crd";

export const namespace = new k8s.core.v1.Namespace(
  "cockroach",
  { metadata: { name: "cockroach" } },
  { provider }
);

export const serverTLS = new crd.certmanager.v1.Certificate(
  "cockroach-tls-server",
  {
    metadata: {
      name: "cockroach-tls-server",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "cockroach-tls-server",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "node",
      dnsNames: [
        "*.cockroach-cockroachdb.cockroach.svc.cluster.local",
        "*.cockroach-cockroachdb",
        "cockroach-cockroachdb"
      ],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const clientTLS = new crd.certmanager.v1.Certificate(
  "cockroach-tls-client",
  {
    metadata: {
      name: "cockroach-tls-client"
    },
    spec: {
      secretName: "cockroach-tls-client",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "node",
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const peerTLS = new crd.certmanager.v1.Certificate(
  "cockroach-tls-peer",
  {
    metadata: {
      name: "cockroach-tls-peer",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "cockroach-tls-peer",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "root",
      dnsNames: ["*.cockroach-cockroachdb.cockroach.svc.cluster.local"],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "cockroach",
  {
    namespace: namespace.metadata.name,
    chart: "cockroachdb",
    fetchOpts: { repo: "https://charts.cockroachdb.com/" },
    values: {
      statefulset: {
        replicas: 3,
        updateStrategy: { type: "RollingUpdate" },
        podManagementPolicy: "Parallel",
        budget: { maxUnavailable: 1 },
        podAntiAffinity: { type: "soft", weight: 100 }
      },
      tls: {
        enabled: true,
        certs: {
          provided: true,
          tlsSecret: true,
          clientRootSecret: peerTLS.spec.secretName,
          nodeSecret: serverTLS.spec.secretName
        }
      },
      storage: { persistentVolume: { storageClass: "ssd" } }
    }
  },
  { provider }
);

export const ingress = new k8s.networking.v1beta1.Ingress(
  "cockroach-ingress",
  {
    metadata: {
      name: "grafana",
      namespace: namespace.metadata.name,
      annotations: {
        "kubernetes.io/ingress.class": "internal",
        "nginx.ingress.kubernetes.io/backend-protocol": "HTTPS",
        "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as ObjectMeta)
          .name!
      }
    },
    spec: {
      tls: [
        {
          hosts: ["*.m3o.sh"],
          secretName: "wildcard-tls"
        }
      ],
      rules: [
        {
          host: "cockroach.m3o.sh",
          http: {
            paths: [
              {
                path: "/",
                pathType: "prefix",
                backend: {
                  serviceName: "cockroach-cockroachdb",
                  servicePort: 8080
                }
              }
            ]
          }
        }
      ]
    }
  },
  { provider, dependsOn: internalChart }
);

export default [namespace, peerTLS, serverTLS, clientTLS, chart];
