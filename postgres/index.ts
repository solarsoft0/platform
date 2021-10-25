import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import * as k8s from "@pulumi/kubernetes";
import { project, vpc, cluster } from "../cluster";
import * as gcp from "@pulumi/gcp";


const conf = new pulumi.Config("digitalocean");
const gcpConf = new pulumi.Config("gcp");

export const postgres = new ocean.DatabaseCluster("postgres-cluster",
    {
        engine: "pg",
        nodeCount: conf.getNumber("postgres_count") || 2,
        region: conf.require("region") as ocean.Region,
        size: conf.get("postgres_slug") as ocean.DatabaseSlug || "db-s-4vcpu-8gb" as ocean.DatabaseSlug,
        version: "13",
        privateNetworkUuid: vpc.id,
    },
    {
        parent: project,
      dependsOn: cluster
    }
);

export const postgresfw = new ocean.DatabaseFirewall("postgres-fw",
    {
        clusterId: postgres.id,
        rules: [
            {
                type: "k8s",
                value: cluster.id,
            }
        ]
    },
  {
    dependsOn: postgres
  }
)

export const pr = new ocean.ProjectResources("pr-postgres", {
  project: project.id,
  resources: [postgres.clusterUrn]
})

export const bucket = new gcp.storage.Bucket("postgres-bucket", {
  location: gcpConf.require("region"),
  project: gcpConf.require("project"),
});

export const backupCron = new k8s.batch.v1beta1.CronJob("postgres-backup", {
  spec : {
    schedule: "0 */2 * * *",
    jobTemplate: {
      metadata: {
        namespace: "server"
      },
      spec: {
        template:{
          metadata: {
            namespace: "server"
          },
          spec: {
            restartPolicy: "Never",
            containers: [
              {
                name: "postgres-backup",
                image: "ghcr.io/m3o/postgres-backup",
                imagePullPolicy: "Always",
                env: [
                  {
                    name: "MICRO_S3_BACKUP_BUCKET",
                    value: bucket.name
                  },
                  {
                    name: "MICRO_S3_ACCESS_KEY",
                    value: gcpConf.require("s3_access_key")
                  },
                  {
                    name: "MICRO_S3_SECRET_KEY",
                    value: gcpConf.require("s3_secret_key")
                  },
                  {
                    name: "MICRO_POSTGRES_HOST",
                    value: postgres.host
                  },
                  {
                    name: "MICRO_POSTGRES_PORT",
                    value: pulumi.interpolate`${postgres.port}`
                  },
                  {
                    name: "MICRO_POSTGRES_USER",
                    value: postgres.user
                  },
                  {
                    name: "MICRO_POSTGRES_PASS",
                    value: postgres.password
                  }
                ]
              }
            ],
          }
        }
      }
    }
  }
})
