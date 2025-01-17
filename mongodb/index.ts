import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import { project, vpc, cluster } from "../cluster";
import * as k8s from "@pulumi/kubernetes";

const conf = new pulumi.Config("digitalocean");

export const mongo = new ocean.DatabaseCluster("api-mongo-cluster",
    {
        engine: "mongodb",
        nodeCount: conf.getNumber("mongo_count") as any || 1,
        region: conf.require("region") as ocean.Region,
        size: conf.get("mongo_slug") as ocean.DatabaseSlug || "db-s-2vcpu-4gb" as ocean.DatabaseSlug,
        version: "4",
        privateNetworkUuid: vpc.id,
        tags: ["m3o"]
    },
    {
        parent: project,
      dependsOn: cluster
    }
);

export const mongofw = new ocean.DatabaseFirewall("api-mongo-fw",
    {
        clusterId: mongo.id,
        rules: [
            {
                type: "k8s",
                value: cluster.id,
            }
        ]
    },
  {
    dependsOn: mongo
  }
)

export const pr = new ocean.ProjectResources("pr-mongo", {
  project: project.id,
  resources: [mongo.clusterUrn]
})
