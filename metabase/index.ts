import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";  
import { K8SExec } from "../exec";
import timescale, { namespace as tsNamespace } from '../timescale';
import { provider, kubeconfig } from "../cluster";
import { namespace } from '../monitoring';

const cf = new pulumi.Config("dply");

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
      `create user metabase with password '${cf.require("metabase_db_password").toString()}';`
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
    cmd: [
      "psql",
      "-c",
      `GRANT ALL PRIVILEGES ON DATABASE metabase TO metabase`
    ]
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
      uri: "timescale.timescale:5432/analytics",
      username: "metabase",
      password: cf.require("metabase_db_password"),
    },
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
        existingSecretUsernameKey: "username",
        existingSecretPasswordKey: "password",
        existingSecretConnectionURIKey: "uri",
      },
    },
  },
  { provider, dependsOn: [dbAccessAnalytics, dbAccess] },
);

export default [
  dbUser,
  dbAccessAnalytics,
  database,
  dbAccess,
  chart,
]