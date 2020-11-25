# Requires https://github.com/pulumi/crd2pulumi
crds:
	crd2pulumi --nodejsPath ./crd ./certmanager/crds/* --force
