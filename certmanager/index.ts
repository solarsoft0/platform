import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from '../cluster';

const conf = new pulumi.Config("dply");

export const namespace = new k8s.core.v1.Namespace(
  "cert-manager",
  { metadata: { name: "cert-manager" } },
  { provider }
);

export const cfAPIKey = new k8s.core.v1.Secret(
  "cloudflare-api-key",
  {
    metadata: { namespace: namespace.metadata.name, name: "cloudflare-api-key" },
    stringData: { cloudflare: conf.require("cloudflare-api-key") }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "certmanager",
  {
    namespace: namespace.metadata.name,
    chart: "cert-manager",
    version: "v1.0.3",
    fetchOpts: { repo: "https://charts.jetstack.io" },
    values: { installCRDs: true }
  },
  { provider, dependsOn: cfAPIKey }
);

export const letsEncryptCerts = new k8s.yaml.ConfigFile(
  "letsencryptcerts",
  { file: "issueracme.yaml" },
  { provider, dependsOn: chart }
);

export const ca = new k8s.core.v1.Secret(
  "ca",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "ca"
    },
    stringData: {
      "tls.crt": conf.require("ca-crt"),
      "tls.key": conf.require("ca-key")
    }
  },
  { provider, dependsOn: chart }
);

export const caCerts = new k8s.yaml.ConfigFile(
  "cacerts",
  { file: "issuercustomca.yaml" },
  { provider, dependsOn: chart }
);

export default [
  namespace,
  cfAPIKey,
  chart,
  letsEncryptCerts,
  ca,
  caCerts,
];