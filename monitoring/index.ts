import * as k8s from "@pulumi/kubernetes";
import { namespace as tsNamespace, default as ts } from '../timescale';
import { kubeconfig, provider } from '../cluster';
import { K8SExec } from '../exec';

export const namespace = new k8s.core.v1.Namespace(
  "monitoring",
  { metadata: { name: "monitoring" } },
  { provider }
);

export const database = new K8SExec(
  "analytics-db",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", "CREATE DATABASE analytics;"]
  },
  { dependsOn: ts }
);

export default [
  namespace,
  database,
]