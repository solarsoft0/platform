import * as docker from "@pulumi/docker";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const registry = new gcp.container.Registry("gcp_ts_registry", {
  location: "EU"
});

export const tailscaleImage = new docker.Image(
  "tailscale",
  {
    imageName: pulumi.interpolate`eu.gcr.io/${gcp.config.project}/tailscale:latest`,
    build: {
      context: "./tailscale"
    },
  },
  { dependsOn: registry }
);

export default [registry, tailscaleImage];
