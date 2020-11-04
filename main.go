package main

import (
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/compute"
	"github.com/pulumi/pulumi-gcp/sdk/v3/go/gcp/container"
	corev1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/core/v1"
	"github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/helm/v3"
	metav1 "github.com/pulumi/pulumi-kubernetes/sdk/v2/go/kubernetes/meta/v1"
	"github.com/pulumi/pulumi/sdk/v2/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v2/go/pulumi/config"
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
			Network:        network.SelfLink,
			NetworkingMode: pulumi.String("VPC_NATIVE"),
			IpAllocationPolicy: &container.ClusterIpAllocationPolicyArgs{
				ClusterIpv4CidrBlock:  pulumi.String(""),
				ServicesIpv4CidrBlock: pulumi.String(""),
			},
			InitialNodeCount:    pulumi.Int(1),
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

		np, err := container.NewNodePool(ctx, "micro", &container.NodePoolArgs{
			Cluster:          cluster.Name,
			InitialNodeCount: pulumi.Int(1),
			Autoscaling: &container.NodePoolAutoscalingArgs{
				MinNodeCount: pulumi.Int(1),
				MaxNodeCount: pulumi.Int(3),
			},
			NodeConfig: &container.NodePoolNodeConfigArgs{
				Preemptible: pulumi.Bool(true),
				MachineType: pulumi.String("e2-standard-2"),
			},
		})
		if err != nil {
			return err
		}

		ns, err := corev1.NewNamespace(ctx, "cert-manager", &corev1.NamespaceArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Name: pulumi.String("cert-manager"),
			},
		})
		if err != nil {
			return err
		}

		ctx.Export("nodepool", np.Name)
		c := config.New(ctx, "")
		corev1.NewSecret(ctx, "cloudflare-api-key", &corev1.SecretArgs{
			Metadata: &metav1.ObjectMetaArgs{
				Namespace: ns.Metadata.Name(),
				Name:      pulumi.String("cloudflare-api-key"),
			},
			StringData: pulumi.StringMap{
				"cloudflare": pulumi.String(c.Require("cloudflare-api-key")),
			},
		})

		// Cert manager
		_, err = helm.NewChart(ctx, "certmanager", helm.ChartArgs{
			Chart:   pulumi.String("cert-manager"),
			Version: pulumi.String("v1.0.3"),
			FetchArgs: helm.FetchArgs{
				Repo: pulumi.String("https://charts.jetstack.io"),
			},
			Values: pulumi.Map{
				"installCRDs": pulumi.Bool(true),
			},
		})
		if err != nil {
			return err
		}

		// // Create a letsencrypt issuer
		// _, err = yaml.NewConfigFile(ctx, "letsencryptcerts", &yaml.ConfigFileArgs{
		// 	File: "letsencrypt.yaml",
		// })
		// if err != nil {
		// 	return err
		// }

		return nil
	})
}
