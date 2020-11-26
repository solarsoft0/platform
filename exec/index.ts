import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@kubernetes/client-node";
import * as crypto from "crypto";
import * as stream from 'stream';
import * as retry from 'async-retry';

export interface K8SExecArgs {
  namespace: pulumi.Input<string>;
  podSelector: pulumi.Input<string>;
  kubeConfig: pulumi.Input<string>;
  cmd: string[];
  container: pulumi.Input<string>;
}

class K8SExecProvider implements pulumi.dynamic.ResourceProvider {
  public async check(
    _olds: K8SExecArgs,
    news: K8SExecArgs
  ): Promise<pulumi.dynamic.CheckResult> {
    const failures = [];
    if (news.cmd === undefined) {
      failures.push({
        property: news.cmd,
        reason: `required property sqlCommands missing`
      });
    }
    return { inputs: news, failures };
  }

  public async diff(
    _id: pulumi.ID,
    olds: K8SExecArgs,
    news: K8SExecArgs
  ): Promise<pulumi.dynamic.DiffResult> {
    const replaces = [];

    if (olds.namespace !== news.namespace) {
      replaces.push("namespace");
    }

    if (olds.podSelector !== news.podSelector) {
      replaces.push("podSelector");
    }

    if (olds.cmd?.join("") !== news.cmd?.join("")) {
      replaces.push("cmds");
    }

    return { replaces };
  }

  public async create(
    inputs: K8SExecArgs
  ): Promise<pulumi.dynamic.CreateResult> {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(inputs.kubeConfig.toString());

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const pods = await retry(() => k8sApi.listNamespacedPod(
      inputs.namespace.toString(),
      undefined,
      undefined,
      undefined,
      "",
      inputs.podSelector.toString()
    ), {retries: 25, maxTimeout: 30000});

    if (!pods.body.items.length) {
      throw new Error("no pods found for selector");
    }

    const pod = pods.body.items[0];
    const exec = new k8s.Exec(kc);

    var results: string[] = [];

    exec.exec(pod.metadata?.namespace!, pod.metadata?.name!, inputs.container.toString(), inputs.cmd,
      process.stdout as stream.Writable, process.stderr as stream.Writable, process.stdin as stream.Readable,
    false /* tty */,
    (status: k8s.V1Status) => {
        // tslint:disable-next-line:no-console
      if(status.status !== "Success"){
        throw new Error("Exec failed: " + JSON.stringify(status, null, 2))
      }
      results.push(JSON.stringify(status, null, 2))
    });


    const idHash = crypto.createHash("sha256");
    inputs.cmd.forEach(x => {
      idHash.update(x.toString());
    });

    return {
      id: "sql-run-" + idHash.digest("hex"),
      outs: { results }
    };
  }
}

export class K8SExec extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: K8SExecArgs,
    opts?: pulumi.CustomResourceOptions
  ) {
    super(
      new K8SExecProvider(),
      name,
      {
        ...args
      },
      opts
    );
  }
}
