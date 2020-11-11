import * as k8s from '@pulumi/kubernetes';
import * as etcd from '../etcd';
import * as nats from '../nats';
import * as cockroach from '../cockroach';
import * as crd from '../crd';
import { provider } from '../cluster';
import { ObjectMeta } from '../crd/meta/v1';

const image = 'bentoogood/micro:pulumi';
const imagePullPolicy = 'Always';
const replicas = 2;

function microDeployment(srv: string, port: number): k8s.apps.v1.Deployment {
  let proxy: string = '';
  let dependsOn: any[] = [...cockroach.default, ...etcd.default, ...nats.default];

  if(srv !== 'network') {
    // use the network as the proxy 
    proxy = `${networkService.metadata.name}.${networkService.metadata.namespace}:${networkService.spec.ports[0].port}`;
    dependsOn.push(networkService);
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
            containers: [
              {
                name: 'micro',
                env: [
                  {
                    name: 'MICRO_SERVICE_NAME',
                    value: srv,
                  },
                  {
                    name: 'MICRO_PROFILE',
                    value: 'platform',
                  },
                  {
                    name: 'MICRO_PROXY',
                    value: proxy,
                  },
                  {
                    name: 'MICRO_BROKER_ADDRESS',
                    value: 'nats-cluster.nats:6222',
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
                    name: 'MICRO_EVENTS_ADDRESS',
                    value: 'nats-cluster.nats-streaming:6222',
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
                ],
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
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn },
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
export const routerDeployment = microDeployment('router', 8084);
export const runtimeDeployment = microDeployment('runtime', 8088);
export const storeDeployment = microDeployment('store', 8002);

const server = [
  authDeployment,
  brokerDeployment,
  configDeployment,
  eventsDeployment,
  networkDeployment,
  registryDeployment,
  routerDeployment,
  runtimeDeployment,
  storeDeployment,
]

export const jwtCert = new crd.certmanager.v1.Certificate(
  'auth-cert',
  {
    metadata: {
      name: 'jwt-creds',
    },
    spec: {
      secretName: 'jwt-creds',
      subject: {
        organizations: ['m3o']
      },
      isCA: false,
      commonName: 'auth',
      privateKey: {
        algorithm: 'ECDSA',
        size: 256
      },
      issuerRef: {
        name: 'ca',
        kind: 'ClusterIssuer'
      }
    }
  },
  { provider }
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
  { provider },
);

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
  { provider },
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
                  containerPort: 8080,
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

export default [
  authDeployment,
  brokerDeployment,
  configDeployment,
  eventsDeployment,
  networkDeployment,
  registryDeployment,
  routerDeployment,
  runtimeDeployment,
  storeDeployment,
  networkService,
  apiService,
  apiDeployment,
  proxyService,
  proxyDeployment,
]