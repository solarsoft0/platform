module github.com/m3o/platform/profile/platform

go 1.15

require (
	github.com/micro/micro/plugin/cockroach/v3 v3.0.0-20210506120339-131287e16d8c
	github.com/micro/micro/plugin/etcd/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/nats/broker/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/nats/stream/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/prometheus/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/v3 v3.2.2-0.20210506120339-131287e16d8c
	github.com/urfave/cli/v2 v2.3.0
)

replace google.golang.org/grpc => google.golang.org/grpc v1.26.0
