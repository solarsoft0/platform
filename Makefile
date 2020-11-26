# Requires https://github.com/pulumi/crd2pulumi
crds:
	crd2pulumi --nodejsPath ./crd ./certmanager/crds/* --force

prom:
	go get github.com/prometheus/prometheus/cmd/...
	promtool check config ./prometheus/*/scrape.yml
	promtool check rules ./prometheus/*/rules.yml ./prometheus/*/alerts.yml

