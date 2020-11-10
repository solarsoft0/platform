import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import * as crd from "../crd";

export const namespace = new k8s.core.v1.Namespace(
  "cockroach",
  { metadata: { name: "cockroach" } },
  { provider }
);

export const tls = new crd.certmanager.v1.Certificate(
  "cockroach-tls",
  {
    metadata: {
      name: "cockroach-tls",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "cockroach-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      dnsNames: [
        "*.cockroach.cockroach.svc.cluster.local",
        "cockroach.cockroach.svc.cluster.local"
      ],
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
          clientRootSecret: tls.spec.secretName,
          nodeSecret: tls.spec.secretName
        }
      },
      storage: { persistentVolume: { storageClass: "ssd" } }
    }
  },
  { provider }
);

export default [namespace, tls, chart];
