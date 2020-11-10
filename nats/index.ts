import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import * as crd from "../crd";

export const namespace = new k8s.core.v1.Namespace(
  "nats",
  { metadata: { name: "nats" } },
  { provider }
);

export const peerTLS = new crd.certmanager.v1.Certificate(
  "nats-peer-tls",
  {
    metadata: {
      name: "nats-peer-tls",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "nats-peer-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      dnsNames: [
        "*.nats.nats.svc.cluster.local",
        "nats.nats.svc.cluster.local",
        "nats.nats"
      ],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const serverTLS = new crd.certmanager.v1.Certificate(
  "nats-server-tls",
  {
    metadata: {
      name: "nats-server-tls",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "nats--server-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      dnsNames: [
        "*.nats.nats.svc.cluster.local",
        "nats.nats.svc.cluster.local",
        "nats.nats"
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
  "nats",
  {
    namespace: namespace.metadata.name,
    chart: "nats/nats",
    fetchOpts: { repo: "https://nats-io.github.io/k8s/helm/charts/" },
    values: {
      nats: {
        tls: {
          secret: { name: serverTLS.metadata.name }
        }
      },
      cluster: {
        enabled: true,
        replicas: 3,
        tls: {
          secret: { name: peerTLS.metadata.name }
        }
      },
      metrics: { enabled: true }
    }
  },
  { provider }
);

export default [namespace, peerTLS, serverTLS, chart];
