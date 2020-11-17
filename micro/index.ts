import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as ocean from '@pulumi/digitalocean';
import * as etcd from '../etcd';
import * as nats from '../nats';
import * as cockroach from '../cockroach';
import * as crd from '../crd';
import { project, provider } from '../cluster';
import { ObjectMeta } from '../crd/meta/v1';
import { Output } from '@pulumi/pulumi';

const image = 'bentoogood/micro:pulumi';
const imagePullPolicy = 'Always';
const replicas = 2;

export const jwtCert = new crd.certmanager.v1.Certificate(
  'jwt-creds',
  {
    metadata: {
      name: 'jwt-creds',
    },
    spec: {
      duration: "87600h", // 10 years
      secretName: 'jwt-creds',
      subject: {
        organizations: ['m3o']
      },
      isCA: false,
      commonName: 'auth',
      privateKey: {
        algorithm: 'RSA',
        size: 4096
      },
      issuerRef: {
        name: 'ca',
        kind: 'ClusterIssuer'
      }
    }
  },
  { provider }
)

export const runtimeServiceAccount = new k8s.core.v1.ServiceAccount(
  "runtime-service-account",
  {
    metadata: {
      name: "micro-runtime",
    },
  },
  { provider },
);

export const runtimeRole = new k8s.rbac.v1.ClusterRole(
  "runtime-role",
  {
    "metadata": {
      "name": "micro-runtime"
    },
    "rules": [
      {
        "apiGroups": [
          ""
        ],
        "resources": [
          "pods",
          "pods/log",
          "services",
          "secrets",
          "namespaces",
          "resourcequotas"
        ],
        "verbs": [
          "get",
          "create",
          "update",
          "delete",
          "deletecollection",
          "list",
          "patch",
          "watch"
        ]
      },
      {
        "apiGroups": [
          "apps"
        ],
        "resources": [
          "deployments"
        ],
        "verbs": [
          "create",
          "update",
          "delete",
          "list",
          "patch",
          "watch"
        ]
      },
      {
        "apiGroups": [
          ""
        ],
        "resources": [
          "secrets",
          "pods",
          "pods/logs"
        ],
        "verbs": [
          "get",
          "watch",
          "list"
        ]
      },
      {
        "apiGroups": [
          "networking.k8s.io"
        ],
        "resources": [
          "networkpolicy",
          "networkpolicies"
        ],
        "verbs": [
          "get",
          "create",
          "update",
          "delete",
          "deletecollection",
          "list",
          "patch",
          "watch"
        ]
      }
    ]
  },
  { provider }
);

export const runtimeClusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(
  "runtime-cluster-role-binding",
  {
    "metadata": {
      "name": "micro-runtime"
    },
    "subjects": [
      {
        "kind": "ServiceAccount",
        "name": runtimeServiceAccount.metadata.name,
        "namespace": "default"
      }
    ],
    "roleRef": {
      "kind": "ClusterRole",
      "name": runtimeRole.metadata.name,
      "apiGroup": "rbac.authorization.k8s.io"
    }
  },
  { provider },
);

export const runtimeRoleBinding = new k8s.rbac.v1.RoleBinding(
  "runtime-role-binding",
  {
    "metadata": {
      "name": "micro-runtime"
    },
    "roleRef": {
      "apiGroup": "rbac.authorization.k8s.io",
      "kind": "ClusterRole",
      "name": runtimeRole.metadata.name,
    },
    "subjects": [
      {
        "kind": "ServiceAccount",
        "name": runtimeServiceAccount.metadata.name,
      }
    ]  
  },
  { provider },
);

const conf = new pulumi.Config('digitalocean');
export const spacesSecret = new k8s.core.v1.Secret("spaces-secret", {
  metadata: {
    name: "do-spaces",
  },
  stringData: {
    accessId: conf.require('spacesAccessId'),
    secretKey: conf.require('spacesSecretKey'),
  },
}, { provider })

function microDeployment(srv: string, port: number): k8s.apps.v1.Deployment {
  let env: pulumi.Input<pulumi.Input<k8s.types.input.core.v1.EnvVar>[]> = [
    {
      name: 'MICRO_SERVICE_NAME',
      value: srv,
    },
    {
      name: 'MICRO_PROFILE',
      value: 'platform',
    },
    {
      name: 'MICRO_AUTH_PUBLIC_KEY',
      valueFrom: {
        secretKeyRef: {
          name: (jwtCert.metadata as ObjectMeta).name,
          key: "tls.crt",
        },
      },
    },
    {
      name: 'MICRO_AUTH_PRIVATE_KEY',
      valueFrom: {
        secretKeyRef: {
          name: (jwtCert.metadata as ObjectMeta).name,
          key: "tls.key",
        },
      },
    },
    {
      name: 'MICRO_SERVICE_ADDRESS',
      value: `:${port}`,
    },
    {
      name: 'MICRO_BROKER_ADDRESS',
      value: 'nats.nats:4222',
    },
    {
      name: 'MICRO_BROKER_TLS_CA',
      value: '/certs/broker/ca.crt',
    },
    {
      name: 'MICRO_BROKER_TLS_CERT',
      value: '/certs/broker/tls.crt',
    },
    {
      name: 'MICRO_BROKER_TLS_KEY',
      value: '/certs/broker/tls.key',
    },
    {
      name: 'MICRO_EVENTS_TLS_CA',
      value: '/certs/events/ca.crt',
    },
    {
      name: 'MICRO_EVENTS_TLS_CERT',
      value: '/certs/events/tls.crt',
    },
    {
      name: 'MICRO_EVENTS_TLS_KEY',
      value: '/certs/events/tls.key',
    },
    {
      name: 'MICRO_REGISTRY_TLS_CA',
      value: '/certs/registry/ca.crt',
    },
    {
      name: 'MICRO_REGISTRY_TLS_CERT',
      value: '/certs/registry/tls.crt',
    },
    {
      name: 'MICRO_REGISTRY_TLS_KEY',
      value: '/certs/registry/tls.key',
    },
    {
      name: 'MICRO_REGISTRY_ADDRESS',
      value: 'etcd.etcd:2379',
    },
    {
      name: 'MICRO_STORE_ADDRESS',
      value: `postgresql://root@cockroach-cockroachdb-public.cockroach:26257?ssl=true&sslmode=require&sslrootcert=certs/store/ca.crt&sslkey=certs/store/tls.key&sslcert=certs/store/tls.crt`,
    },
  ];

  if(srv === 'runtime' || srv === 'store') {
    env.push(
      {
        name: 'MICRO_BLOB_STORE_REGION',
        value: 'ams3',
      },
      {
        name: 'MICRO_BLOB_STORE_ENDPOINT',
        value: 'ams3.digitaloceanspaces.com',
      },
      {
        name: 'MICRO_BLOB_STORE_ACCESS_KEY',
        valueFrom: {
          secretKeyRef: {
            name: spacesSecret.metadata.name,
            key: 'accessId',
          },
        },
      },
      {
        name: 'MICRO_BLOB_STORE_SECRET_KEY',
        valueFrom: {
          secretKeyRef: {
            name: spacesSecret.metadata.name,
            key: 'secretKey',
          },
        },
      },
    );
  }

  if(srv !== 'network') {
    // use the network as the proxy 
    env.push({
      name: 'MICRO_PROXY',
      value: pulumi.interpolate `${networkService.metadata.name}.${networkService.metadata.namespace}:${networkService.spec.ports[0].port}`,
    });
  }

  let serviceAccount: Output<string> | string = 'default';
  if(srv === 'runtime') {
    serviceAccount = runtimeServiceAccount.metadata.name;
  }

  return new k8s.apps.v1.Deployment(
    `micro-${srv}-deployment`,
    {
      metadata: {
        name: `micro-${srv}`,
        labels: {
          name: srv,
          version: 'latest',
          micro: 'server',
        },
      },
      spec: {
        replicas,
        selector: {
          matchLabels: {
            name: srv,
            version: 'latest',
            micro: 'server',
          },
        },
        template: {
          metadata: {
            labels: {
              name: srv,
              version: 'latest',
              micro: 'server',    
            },
            annotations: {
              'prometheus.io/scrape': 'true',
              'prometheus.io/path': '/metrics',
              'prometheus.io/port': '9000',
            },
          },
          spec: {
            serviceAccount,
            containers: [
              {
                resources: {
                  limits: {
                    cpu: '1',
                    memory: '4Gi',
                  },
                  requests: {
                    cpu: '100m',
                    memory: '100Mi',
                  },
                },
                name: 'micro',
                env,
                args: ['service', srv],
                image,
                imagePullPolicy,
                ports: [
                  {
                    name: `${srv}-port`,
                    containerPort: port,
                  }
                ],
                readinessProbe: {
                  tcpSocket: {
                    port: `${srv}-port`,
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                volumeMounts: [
                  {
                    name: 'etcd-client-certs',
                    mountPath: '/certs/registry',
                    readOnly: true,
                  },
                  {
                    name: 'nats-client-certs',
                    mountPath: '/certs/broker',
                    readOnly: true,
                  },
                  {
                    name: 'nats-client-certs',
                    mountPath: '/certs/events',
                    readOnly: true,
                  },
                  {
                    name: 'cockroachdb-client-certs',
                    mountPath: '/certs/store',
                    readOnly: true,
                  },
                ],
              },
            ],
            volumes: [
              {
                name: 'etcd-client-certs',
                secret: {
                  secretName: etcd.clientTLS.spec.secretName,
                },
              },
              {
                name: 'nats-client-certs',
                secret: {
                  secretName: nats.clientTLS.spec.secretName,
                },
              },
              {
                name: 'cockroachdb-client-certs',
                secret: {
                  secretName: cockroach.clientTLS.spec.secretName,
                  defaultMode: 0o600,
                },
              },
            ],
          },
        },
      },
    },
    { provider },
  )
}

export const networkDeployment = microDeployment('network', 8443);
export const networkService = new k8s.core.v1.Service(
  'micro-network-service',
  {
    metadata: {
      name: 'micro-network',
      namespace: 'default',
      labels: {
        name: 'network',
        version: 'latest',
        micro: 'server',
      },
    },
    spec: {
      ports: [
        {
          name: 'http',
          port: 8443,
          targetPort: 8443,
        },
      ],
      selector: {
        name: 'network',
        version: 'latest',
        micro: 'server',        
      },
    },
  },
  { provider, dependsOn: networkDeployment },
);

export const authDeployment = microDeployment('auth', 8010);
export const brokerDeployment = microDeployment('broker', 8003);
export const configDeployment = microDeployment('config', 8081);
export const eventsDeployment = microDeployment('events', 8080);
export const registryDeployment = microDeployment('registry', 8000);
export const runtimeDeployment = microDeployment('runtime', 8088);
export const storeDeployment = microDeployment('store', 8002);

const server = [
  authDeployment,
  brokerDeployment,
  configDeployment,
  eventsDeployment,
  networkDeployment,
  registryDeployment,
  runtimeDeployment,
  storeDeployment,
]

export const apiDeployment = new k8s.apps.v1.Deployment(
  'micro-api-deployment',
  {
    metadata: {
      name: 'micro-api',
      labels: {
        name: 'api',
        version: 'latest',
        micro: 'server',
      },
    },
    spec: {
      replicas,
      selector: {
        matchLabels: {
          name: 'api',
          version: 'latest',
          micro: 'server',
        },
      },
      template: {
        metadata: {
          labels: {
            name: 'api',
            version: 'latest',
            micro: 'server',    
          },
          annotations: {
            'prometheus.io/scrape': 'true',
            'prometheus.io/path': '/metrics',
            'prometheus.io/port': '9000',
          },
        },
        spec: {
          containers: [
            {
              name: 'micro',
              env: [
                {
                  name: 'MICRO_API_RESOLVER',
                  value: 'subdomain',
                },
                {
                  name: 'MICRO_AUTH_PUBLIC_KEY',
                  valueFrom: {
                    secretKeyRef: {
                      name: (jwtCert.metadata as ObjectMeta).name,
                      key: "tls.crt",
                    },
                  },
                },
                {
                  name: 'MICRO_AUTH_PRIVATE_KEY',
                  valueFrom: {
                    secretKeyRef: {
                      name: (jwtCert.metadata as ObjectMeta).name,
                      key: "tls.key",
                    },
                  },
                },
                {
                  name: 'MICRO_PROFILE',
                  value: 'client',
                },
                {
                  name: 'MICRO_PROXY',
                  value: 'micro-network.default.svc.cluster.local:8443',
                },
              ],
              args: ['service', 'api'],
              image,
              imagePullPolicy,
              ports: [
                {
                  name: 'api-port',
                  containerPort: 8080,
                }
              ],
              readinessProbe: {
                tcpSocket: {
                  port: 'api-port',
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
            },
          ],
        },
      },
    },
  },
  { provider, dependsOn: [...server, jwtCert] },
)

export const apiService = new k8s.core.v1.Service(
  'micro-api-service',
  {
    metadata: {
      name: 'micro-api',
      labels: {
        name: 'api',
        version: 'latest',
        micro: 'server',
      },
    },
    spec: {
      ports: [
        {
          name: 'http',
          port: 8080,
          targetPort: 8080,
        },
      ],
      selector: {
        name: 'api',
        version: 'latest',
        micro: 'server',        
      },
    },
  },
  { provider, dependsOn: apiDeployment },
);

export const proxyDeployment = new k8s.apps.v1.Deployment(
  'micro-proxy-deployment',
  {
    metadata: {
      name: 'micro-proxy',
      labels: {
        name: 'proxy',
        version: 'latest',
        micro: 'server',
      },
    },
    spec: {
      replicas,
      selector: {
        matchLabels: {
          name: 'proxy',
          version: 'latest',
          micro: 'server',
        },
      },
      template: {
        metadata: {
          labels: {
            name: 'proxy',
            version: 'latest',
            micro: 'server',    
          },
          annotations: {
            'prometheus.io/scrape': 'true',
            'prometheus.io/path': '/metrics',
            'prometheus.io/port': '9000',
          },
        },
        spec: {
          containers: [
            {
              name: 'micro',
              env: [
                {
                  name: 'MICRO_AUTH_PUBLIC_KEY',
                  valueFrom: {
                    secretKeyRef: {
                      name: (jwtCert.metadata as ObjectMeta).name,
                      key: "tls.crt",
                    },
                  },
                },
                {
                  name: 'MICRO_AUTH_PRIVATE_KEY',
                  valueFrom: {
                    secretKeyRef: {
                      name: (jwtCert.metadata as ObjectMeta).name,
                      key: "tls.key",
                    },
                  },
                },
                {
                  name: 'MICRO_PROFILE',
                  value: 'client',
                },
                {
                  name: 'MICRO_PROXY',
                  value: 'micro-network.default.svc.cluster.local:8443',
                },
              ],
              args: ['service', 'proxy'],
              image,
              imagePullPolicy,
              ports: [
                {
                  name: 'proxy-port',
                  containerPort: 8081,
                }
              ],
              readinessProbe: {
                tcpSocket: {
                  port: 'proxy-port',
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
            },
          ],
        },
      },
    },
  },
  { provider, dependsOn: [...server, jwtCert] },
)

export const proxyService = new k8s.core.v1.Service(
  'micro-proxy-service',
  {
    metadata: {
      name: 'micro-proxy',
      labels: {
        name: 'proxy',
        version: 'latest',
        micro: 'server',
      },
    },
    spec: {
      ports: [
        {
          name: 'grpc',
          port: 8081,
          targetPort: 8081,
        },
      ],
      selector: {
        name: 'proxy',
        version: 'latest',
        micro: 'server',        
      },
    },
  },
  { provider, dependsOn: proxyDeployment },
);

export default [
  authDeployment,
  brokerDeployment,
  configDeployment,
  eventsDeployment,
  networkDeployment,
  registryDeployment,
  runtimeDeployment,
  storeDeployment,
  networkService,
  apiService,
  apiDeployment,
  proxyService,
  proxyDeployment,
]