import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@kubernetes/client-node";
import * as net from "net";
import { once } from "events";
import { Client } from "pg";
import * as crypto from "crypto";
import * as fs from "fs";
import { exec } from 'child_process';

export interface SQLPortForwardArgs {
  namespace: pulumi.Input<string>;
  podSelector: pulumi.Input<string>;
  podPort: pulumi.Input<number>;
  postgresCred: {
    user: string;
    database: string;
    password: string;
  };
  kubeConfig: pulumi.Input<string>;
  sqlCommands: pulumi.Input<string>[];
}

class SQLPortForwardProvider implements pulumi.dynamic.ResourceProvider {
  public async check(
    _olds: SQLPortForwardArgs,
    news: SQLPortForwardArgs
  ): Promise<pulumi.dynamic.CheckResult> {
    const failures = [];
    if (news.sqlCommands === undefined) {
      failures.push({
        property: news.sqlCommands,
        reason: `required property sqlCommands missing`
      });
    }
    return { inputs: news, failures };
  }

  public async diff(
    _id: pulumi.ID,
    olds: SQLPortForwardArgs,
    news: SQLPortForwardArgs
  ): Promise<pulumi.dynamic.DiffResult> {
    const replaces = [];

    if (olds.namespace !== news.namespace) {
      replaces.push("namespace");
    }

    if (olds.kubeConfig !== news.kubeConfig) {
      replaces.push("kubeConfig");
    }

    if (olds.postgresCred !== news.postgresCred) {
      replaces.push("postgresCred");
    }

    if (olds.sqlCommands?.join("") !== news.sqlCommands?.join("")) {
      replaces.push("sqlCommands");
    }

    if (olds.podSelector !== news.podSelector) {
      replaces.push("podSelector");
    }

    return { replaces };
  }

  public async create(
    inputs: SQLPortForwardArgs
  ): Promise<pulumi.dynamic.CreateResult> {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(inputs.kubeConfig.toString());

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const pods = await k8sApi.listNamespacedPod(
      inputs.namespace.toString(),
      undefined,
      undefined,
      undefined,
      "",
      inputs.podSelector.toString()
    );

    if (!pods.body.items.length) {
      throw new Error("no pods found for selector");
    }

    // Use a random port so as to not conflict locally
    const randomPort = Math.floor(Math.random() * 10000) + 5001;
    const pod = pods.body.items[0];

    fs.writeFileSync("kubeconf", new Buffer(inputs.kubeConfig.toString()))
exec(`KUBECONFIG=kubeconf kubectl port-forward ${pod.metadata?.name} -n ${pod.metadata?.namespace} ${randomPort}:5432`, (error, stdout, stderr) => {
  if (error) {
    console.error(`exec error: ${error}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
  console.error(`stderr: ${stderr}`);
});



    // const s = server.listen(randomPort, "localhost");
    // await once(s, "listening");

    // console.log("listening");

    const pgc = new Client({
      user: inputs.postgresCred.user,
      host: "localhost",
      database: inputs.postgresCred.database,
      password: inputs.postgresCred.password,
      port: randomPort,
      ssl: true,
    });
    pgc.connect();

    var results: string[] = [];
    inputs.sqlCommands.forEach(async x => {
      const res = await pgc.query(x.toString());
      console.log(res);
      results.push(res.rows[0]);
    });

    pgc.end();

    const idHash = crypto.createHash("sha256");
    inputs.sqlCommands.forEach(x => {
      idHash.update(x.toString());
    });

    return {
      id: "sql-run-" + idHash.digest("hex"),
      outs: { results }
    };
  }
}

export class SQLPortForward extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: SQLPortForwardArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super(
      new SQLPortForwardProvider(),
      name,
      {
        ...args
      },
      opts
    );
  }
}
