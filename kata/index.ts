import * as k8s from '@pulumi/kubernetes';
import { provider } from '../cluster';

export const qemuVirtiofsRuntimeClass = new k8s.node.v1beta1.RuntimeClass("qemu-virtiofs", {
  metadata: {
    name: "kata-qemu-virtiofs",
  },
  handler: "kata-qemu-virtiofs",
  overhead: {
    podFixed: {
      memory: "160Mi",
      cpu: "250m",
    },
  },
}, { provider });

export const kemuRuntimeClass = new k8s.node.v1beta1.RuntimeClass("kemu", {
  metadata: {
    name: "kata-kemu",
  },
  handler: "kata-kemu",
  overhead: {
    podFixed: {
      memory: "160Mi",
      cpu: "250m",
    },
  },
}, { provider });

export const clhRuntimeClass = new k8s.node.v1beta1.RuntimeClass("clh", {
  metadata: {
    name: "kata-clh",
  },
  handler: "kata-clh",
  overhead: {
    podFixed: {
      memory: "130Mi",
      cpu: "250m",
    },
  },
}, { provider });

export const fcRuntimeClass = new k8s.node.v1beta1.RuntimeClass("fc", {
  metadata: {
    name: "kata-fc",
  },
  handler: "kata-fc",
  overhead: {
    podFixed: {
      memory: "130Mi",
      cpu: "250m",
    },
  },
}, { provider });

export const kataServiceAccount = new k8s.core.v1.ServiceAccount("kata-sa", {
  metadata: {
    name: "kata-label-node",
    namespace: "kube-system",
  },
}, { provider });


export const labelerRole = new k8s.rbac.v1.ClusterRole("node-labeler", {
  metadata: {
    name: "node-labeler",
  },
  rules: [
    {
      apiGroups: [""],
      resources: ["nodes"],
      verbs: ["get", "patch"],
    },
  ],
}, { provider });

export const labelNodeRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("label-node-rb", {
  metadata: {
    name: "kata-label-node-rb"
  },
  roleRef: {
    apiGroup: "rbac.authorization.k8s.io",
    kind: "ClusterRole",
    name: "node-labeler"
  },
  subjects: [
    {
      kind: "ServiceAccount",
      name: "kata-label-node",
      namespace: "kube-system"
    }
  ],
}, { provider });

export const kataDaemonSet = new k8s.apps.v1.DaemonSet("kata", {
  metadata: {
    name: "kata-deploy",
    namespace: "kube-system"
  },
  spec: {
    selector: {
      matchLabels: {
        name: "kata-deploy"
      }
    },
    template: {
      metadata: {
        labels: {
          name: "kata-deploy"
        }
      },
      spec: {
        serviceAccountName: "kata-label-node",
        containers: [
          {
            name: "kube-kata",
            image: "katadocker/kata-deploy",
            imagePullPolicy: "Always",
            lifecycle: {
              preStop: {
                "exec": {
                  "command": [
                    "bash",
                    "-c",
                    "/opt/kata-artifacts/scripts/kata-deploy.sh cleanup"
                  ]
                }
              }
            },
            command: [
              "bash",
              "-c",
              "/opt/kata-artifacts/scripts/kata-deploy.sh install"
            ],
            env: [
              {
                name: "NODE_NAME",
                valueFrom: {
                  fieldRef: {
                    fieldPath: "spec.nodeName"
                  }
                }
              }
            ],
            securityContext: {
              privileged: false
            },
            volumeMounts: [
              {
                name: "crio-conf",
                mountPath: "/etc/crio/"
              },
              {
                name: "containerd-conf",
                mountPath: "/etc/containerd/"
              },
              {
                name: "kata-artifacts",
                mountPath: "/opt/kata/"
              },
              {
                name: "dbus",
                mountPath: "/var/run/dbus"
              },
              {
                name: "systemd",
                mountPath: "/run/systemd"
              },
              {
                name: "local-bin",
                mountPath: "/usr/local/bin/"
              }
            ]
          }
        ],
        volumes: [
          {
            name: "crio-conf",
            hostPath: {
              path: "/etc/crio/"
            }
          },
          {
            name: "containerd-conf",
            hostPath: {
              path: "/etc/containerd/"
            }
          },
          {
            name: "kata-artifacts",
            hostPath: {
              path: "/opt/kata/",
              type: "DirectoryOrCreate"
            }
          },
          {
            name: "dbus",
            hostPath: {
              path: "/var/run/dbus"
            }
          },
          {
            name: "systemd",
            hostPath: {
              path: "/run/systemd"
            }
          },
          {
            name: "local-bin",
            hostPath: {
              path: "/usr/local/bin/"
            }
          }
        ]
      }
    },
    updateStrategy: {
      rollingUpdate: {
        maxUnavailable: 1
      },
      type: "RollingUpdate"
    }
  }
}, { provider });

export default [
  qemuVirtiofsRuntimeClass,
  kemuRuntimeClass,
  clhRuntimeClass,
  fcRuntimeClass,
  kataServiceAccount,
  labelerRole,
  labelNodeRoleBinding,
  kataDaemonSet,
]