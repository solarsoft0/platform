import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";

export const network = new gcp.compute.Network("private-network", {
  autoCreateSubnetworks: true
});

// Create the GKE cluster and export it.
export const cluster = new gcp.container.Cluster("cluster", {
  initialNodeCount: 1,
  removeDefaultNodePool: true,
  network: network.name,
  networkingMode: "VPC_NATIVE",
  enableShieldedNodes: true,
  loggingService: "none",
  monitoringService: "none",
  releaseChannel: { channel: "STABLE" },
  networkPolicy: { enabled: true },
  addonsConfig: { httpLoadBalancing: { disabled: true } },
  ipAllocationPolicy: { clusterIpv4CidrBlock: "", servicesIpv4CidrBlock: "" }
});

export const nodePool = new gcp.container.NodePool("micro", {
  cluster: cluster.name,
  nodeCount: 1,
  autoscaling: { minNodeCount: 1, maxNodeCount: 3 },
  nodeConfig: { preemptible: true, machineType: "e2-standard-2" }
});

// Manufacture a GKE-style Kubeconfig. Note that this is slightly "different" because of the way GKE requires
// gcloud to be in the picture for cluster authentication (rather than using the client cert/key directly).
export const kubeconfig = pulumi
  .all([cluster.name, cluster.endpoint, cluster.masterAuth])
  .apply(([name, endpoint, auth]) => {
    const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
    return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
  });

export const provider = new k8s.Provider(
  "gkeK8s",
  { kubeconfig },
  { dependsOn: [nodePool] },
);

export const ssdStorageClass = new k8s.storage.v1.StorageClass(
  "ssd",
  {
    allowVolumeExpansion: true,
    parameters: { type: "pd-ssd" },
    metadata: { name: "ssd" },
    provisioner: "kubernetes.io/gce-pd"
  },
  { provider }
);

export default [
  network,
  cluster,
  nodePool,
  kubeconfig,
  provider,
  ssdStorageClass,
]