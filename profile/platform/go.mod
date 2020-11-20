module github.com/m3o/platform/profile/platform

go 1.15

require (
	github.com/micro/micro/plugin/cockroach/v3 v3.0.0-20201120132803-2fbadd54c4e2
	github.com/micro/micro/plugin/etcd/v3 v3.0.0-20201120132803-2fbadd54c4e2
	github.com/micro/micro/plugin/nats/broker/v3 v3.0.0-20201120132803-2fbadd54c4e2
	github.com/micro/micro/plugin/nats/stream/v3 v3.0.0-20201120132803-2fbadd54c4e2
	github.com/micro/micro/plugin/prometheus/v3 v3.0.0-20201120132803-2fbadd54c4e2
	github.com/micro/micro/v3 v3.0.1
	github.com/urfave/cli/v2 v2.3.0
)

replace google.golang.org/grpc => google.golang.org/grpc v1.26.0
