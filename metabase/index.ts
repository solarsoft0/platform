import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { K8SExec } from "../exec";
import timescale, { namespace as tsNamespace } from "../timescale";
import { provider, kubeconfig } from "../cluster";
import { namespace } from "../monitoring";
import { letsEncryptCerts } from "../certmanager";
import { ObjectMeta } from "../crd/meta/v1";
import { internalChart } from "../nginx";

const cf = new pulumi.Config("m3o");

export const dbUser = new K8SExec(
  "metabase-user",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `create user metabase with password '${cf
        .require("metabase_db_password")
        .toString()}' SUPERUSER;`
    ]
  },
  { dependsOn: timescale }
);

export const dbAccessAnalytics = new K8SExec(
  "metabase-analytics-grant",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `GRANT ALL PRIVILEGES ON DATABASE analytics TO metabase`
    ]
  },
  { dependsOn: [...timescale, dbUser] }
);

export const database = new K8SExec(
  "metabase-db",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", "CREATE DATABASE metabase;"]
  },
  { dependsOn: timescale }
);

export const dbAccess = new K8SExec(
  "metabase-grant",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", `GRANT ALL PRIVILEGES ON DATABASE metabase TO metabase`]
  },
  { dependsOn: [...timescale, dbUser] }
);

const mbCreds = new k8s.core.v1.Secret(
  "mbCreds",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "metabase-creds"
    },
    stringData: {
      uri: `postgres://metabase:${cf
        .require("metabase_db_password")
        .toString()}@timescale.timescale:5432/metabase?ssl=true&sslmode=require&sslfactory=org.postgresql.ssl.NonValidatingFactory`
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "metabase",
  {
    namespace: namespace.metadata.name,
    chart: "metabase",
    repo: "stable",
    values: {
      database: {
        type: "PostgreSQL",
        existingSecret: mbCreds.metadata.name,
        existingSecretConnectionURIKey: "uri"
      }
    }
  },
  { provider, dependsOn: [dbAccessAnalytics, dbAccess] }
);

export const ingress = new k8s.networking.v1beta1.Ingress(
  "metabase-ingress",
  {
    metadata: {
      name: "metabase",
      namespace: namespace.metadata.name,
      annotations: {
        "kubernetes.io/ingress.class": "internal",
        "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as ObjectMeta)
          .name!
      }
    },
    spec: {
      tls: [
        {
          hosts: ["data.m3o.sh"],
          secretName: "metabase-tls"
        }
      ],
      rules: [
        {
          host: "data.m3o.sh",
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  serviceName: "metabase",
                  servicePort: 80
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

export default [dbUser, dbAccessAnalytics, database, dbAccess, chart, ingress];
