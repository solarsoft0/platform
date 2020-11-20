# Requires https://github.com/pulumi/crd2pulumi
crds:
	crd2pulumi --nodejsPath ./crd ./prometheus/bundle.yaml ./certmanager/crds/* --force
