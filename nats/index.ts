import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import * as crd from "../crd";
import { ObjectMeta } from "../crd/meta/v1";

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
      secretName: "nats-server-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "nats",
      dnsNames: [
        "nats.nats.svc.cluster.local",
        "*.nats.nats.svc",
        "nats",
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
  "nats-client-tls",
  {
    metadata: {
      name: "nats-client-tls",
      namespace: namespace.metadata.name,
    },
    spec: {
      secretName: "nats-client-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      commonName: "nats",
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
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "nats",
  {
    namespace: namespace.metadata.name,
    chart: "nats",
    fetchOpts: { repo: "https://nats-io.github.io/k8s/helm/charts" },
    version: "0.5.6",
    values: {
      nats: {
        tls: {
          secret: { name: (serverTLS.metadata as ObjectMeta).name },
          ca: "ca.crt",
          cert: "tls.crt",
          key: "tls.key",
        },
      },
      cluster: {
        enabled: true,
        replicas: 3,
        tls: {
          secret: { name: (peerTLS.metadata as ObjectMeta).name }
        }
      },
      metrics: { enabled: true }
    }
  },
  { provider }
);

export const streamingChart = new k8s.helm.v3.Chart(
  "nats-streaming",
  {
    namespace: namespace.metadata.name,
    chart: "stan",
    fetchOpts: { repo: "https://nats-io.github.io/k8s/helm/charts" },
    version: "0.5.6",
    values: {
      stan: {
        replicas: 3,
        nats: {
          url: "nats://nats:4222",
        },
        tls: {
          enabled: true,
          secretName: (clientTLS.metadata as ObjectMeta).name,
          settings: {
            client_cert: "/etc/nats/certs/tls.crt",
            client_key: "/etc/nats/certs/tls.key",
            client_ca: "/etc/nats/certs/ca.crt",
          },
        },
      },
      store: {
        type: "file",
        volume: {
          enabled: true,
          mount: "/data/stan",
          storageSize: "3Gi",
          accessModes: "ReadWriteOnce",
        },
        file: {
          path: "/data/stan/store",
        },
        cluster: {
          enabled: true,
          logPath: "/data/stan/log",
        },
      },
    },
  },
  { provider, dependsOn: chart }
);

export default [namespace, peerTLS, serverTLS, clientTLS, chart, streamingChart];
