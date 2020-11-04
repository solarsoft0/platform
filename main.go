package main

import (
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/compute"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/container"
	"github.com/pulumi/pulumi/sdk/v2/go/pulumi"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		network, err := compute.NewNetwork(ctx, "dev", &compute.NetworkArgs{
			AutoCreateSubnetworks: pulumi.BoolPtr(true),
		})

		if err != nil {
			return err
		}

		cluster, err := container.NewCluster(ctx, "dev", &container.ClusterArgs{
			Network:             network.SelfLink,
			NetworkingMode:      pulumi.String("VPC_NATIVE"),
			EnableShieldedNodes: pulumi.BoolPtr(true),
			LoggingService:      pulumi.StringPtr("none"),
			MonitoringService:   pulumi.StringPtr("none"),
			ReleaseChannel:      &container.ClusterReleaseChannelArgs{Channel: pulumi.String("STABLE")},
			NetworkPolicy:       &container.ClusterNetworkPolicyArgs{Enabled: pulumi.Bool(true)},

			// Default node pool is remove anyway
			RemoveDefaultNodePool: pulumi.Bool(true),
			// Disable Google's ingress, as we use Nginx
			AddonsConfig: &container.ClusterAddonsConfigArgs{
				HttpLoadBalancing: &container.ClusterAddonsConfigHttpLoadBalancingArgs{Disabled: pulumi.Bool(true)},
			},
		})
		if err != nil {
			return err
		}

		ctx.Export("kubeconfig", generateKubeconfig(
			cluster.Endpoint, cluster.Name, cluster.MasterAuth))

		np, err := container.NewNodePool(ctx, "testy", &container.NodePoolArgs{
			Cluster:          cluster.SelfLink,
			InitialNodeCount: pulumi.Int(1),
			Autoscaling: &container.NodePoolAutoscalingArgs{
				MinNodeCount: pulumi.Int(1),
				MaxNodeCount: pulumi.Int(3),
			},
			NodeConfig: &container.NodePoolNodeConfigArgs{
				Preemptible:   pulumi.Bool(true),
				MachineType:   pulumi.String("e2-standard-2"),
				OauthScopes:   pulumi.StringArray{},
				SandboxConfig: &container.NodePoolNodeConfigSandboxConfigArgs{SandboxType: pulumi.String("gvisor")},
			},
		})
		if err != nil {
			return err
		}

		ctx.Export("nodepool", np.Name)

		return nil
	})
}

func generateKubeconfig(clusterEndpoint pulumi.StringOutput, clusterName pulumi.StringOutput,
	clusterMasterAuth container.ClusterMasterAuthOutput) pulumi.StringOutput {
	context := pulumi.Sprintf("demo_%s", clusterName)

	return pulumi.Sprintf(`apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: %s
    server: https://%s
  name: %s
contexts:
- context:
    cluster: %s
    user: %s
  name: %s
current-context: %s
kind: Config
preferences: {}
users:
- name: %s
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp`,
		clusterMasterAuth.ClusterCaCertificate().Elem(),
		clusterEndpoint, context, context, context, context, context, context)
}
