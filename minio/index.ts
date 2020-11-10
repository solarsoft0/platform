import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { provider } from '../cluster';
import * as crd from '../crd';

const cf = new pulumi.Config("dply");
const gcpConf = new pulumi.Config("gcp");

export const namespace = new k8s.core.v1.Namespace(
  "minio",
  { metadata: { name: "minio" } },
  { provider }
);

export const cert = new crd.certmanager.v1.Certificate(
  "minio-tls",
  {
    metadata: {
      name: "minio-tls",
      namespace: namespace.metadata.name,
    },
    spec: {
      secretName: "minio-tls",
      subject: {
        organizations: ["m3o"],
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256,
      },
      dnsNames: [
        "minio.minio.svc.cluster.local",
        "minio",
      ],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer",
      },
    },
  },
  { provider },
);

export const serviceAccount = new gcp.serviceaccount.Account("minio", {
  accountId: "miniostorage"
});

export const binding = new gcp.projects.IAMBinding("minio-storage-admin-binding", {
  members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
  role: "roles/storage.admin"
});

export const serviceAccountKey = new gcp.serviceaccount.Key("minio-gcs", {
  serviceAccountId: serviceAccount.id
});

export const chart = new k8s.helm.v3.Chart(
  "minio",
  {
    namespace: namespace.metadata.name,
    chart: "minio",
    version: "8.0.0",
    fetchOpts: { repo: "https://helm.min.io/" },
    values: {
      service: { port: "443" },
      tls: {
        enabled: true,
        certSecret: cert.spec.secretName,
        publicCrt: "tls.crt",
        privateKey: "tls.key"
      },
      persistence: { enabled: false },
      gcsgateway: {
        replicas: 1,
        enabled: true,
        projectId: gcpConf.require("project"),
        gcsKeyJson: serviceAccountKey.privateKey.apply(s => {
          let buff = new Buffer(s, "base64");
          return buff.toString("ascii");
        })
      },
      accessKey: cf.require("minio-access-key"),
      secretKey: cf.require("minio-secret-key"),
      resources: { requests: { memory: 256 } }
    }
  },
  { provider }
);

export default [
  namespace,
  cert,
  serviceAccount,
  binding,
  serviceAccountKey,
  chart,
];