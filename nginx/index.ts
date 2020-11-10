import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as gcp from "@pulumi/gcp";
import { provider } from '../cluster';
import { letsEncryptCerts } from "../certmanager";
import { ObjectMeta } from "../crd/meta/v1";
import { namespace } from "../monitoring"
import grafana from "../grafana";

const conf = new pulumi.Config("gcp");

// export const internalChart = new k8s.helm.v3.Chart(
//   "nginx",
//   {
//     chart: "ingress-nginx",
//     version: "3.9.0",
//     fetchOpts: {
//       repo: "https://kubernetes.github.io/ingress-nginx"
//     },
//   },
//   { provider }
// )

export const externalIP = new gcp.compute.Address(
  "external-ip",
  {
    region: conf.require("region"),
  },
)

export const externalChart = new k8s.helm.v3.Chart(
  "nginx",
  {
    chart: "ingress-nginx",
    version: "3.9.0",
    fetchOpts: {
      repo: "https://kubernetes.github.io/ingress-nginx"
    },
    values: {
      controller: {
        service: {
          loadBalancerIP: externalIP.address,
        },
      },
    },
  },
  { provider },
)

// export const grpcIngress = new k8s.networking.v1beta1.Ingress(
//   "grpc-ingress",
//   {
//     metadata: {
//       name: "grpc-ingress",
//       annotations: {
//         "kubernetes.io/ingress.class": "nginx",
//         "nginx.ingress.kubernetes.io/backend-protocol": "GRPC",
//         "cert-manager.io/issuer": (letsEncryptCerts.metadata as ObjectMeta).name!,
//       },
//     },
//     spec: {
//       tls: [
//         {
//           hosts: ["*.m3o.sh"],
//         }
//       ],
//       rules: [
//         {
//           host: "proxy.m3o.sh",
//           http: {
//             paths: [
//               {
//                 path: "/",
//                 pathType: "prefix",
//                 backend: {
//                   serviceName: "micro-proxy",
//                   servicePort: 8081,
//                 },
//               },
//             ],
//           },
//         },
//       ],
//     },
//   },
//   { provider, dependsOn: externalChart },
// );

// export const httpIngress = new k8s.networking.v1beta1.Ingress(
//   "http-ingress",
//   {
//     metadata: {
//       name: "http-ingress",
//       annotations: {
//         "kubernetes.io/ingress.class": "nginx",
//         "cert-manager.io/issuer": (letsEncryptCerts.metadata as ObjectMeta).name!,
//       },
//     },
//     spec: {
//       tls: [
//         {
//           hosts: ["*.m3o.sh"],
//         }
//       ],
//       rules: [
//         {
//           host: "*.m3o.sh",
//           http: {
//             paths: [
//               {
//                 path: "/",
//                 pathType: "prefix",
//                 backend: {
//                   serviceName: "micro-api",
//                   servicePort: 8080,
//                 },
//               },
//             ],
//           },
//         },
//       ],
//     },
//   },
//   { provider, dependsOn: externalChart },
// );

const grafanaIngress = new k8s.networking.v1beta1.Ingress(
  "grafana-ingress",
  {
    metadata: {
      name: "grafana-ingress",
      namespace: namespace.metadata.name,
      annotations: {
        "kubernetes.io/ingress.class": "nginx",
        "cert-manager.io/issuer": (letsEncryptCerts.metadata as ObjectMeta).name!,
      },
    },
    spec: {
      tls: [
        {
          hosts: ["grafana.m3o.sh"],
        }
      ],
      rules: [
        {
          host: "grafana.m3o.sh",
          http: {
            paths: [
              {
                path: "/",
                pathType: "prefix",
                backend: {
                  serviceName: "grafana",
                  servicePort: 3000,
                },
              },
            ],
          },
        },
      ],
    },
  },
  { provider, dependsOn: externalChart },
);

export default [
  // internalChart,
  externalChart,
  externalIP,
  grafanaIngress,
  // grpcIngress,
  // httpIngress,
]