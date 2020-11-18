# M3O Platform

This is the Pulumi scripts to manage m3o.dev and m3o.org

## Generate the CA for the clusters cert issuer

openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -subj "/CN=m3o" -days 3650 -reqexts v3_req -extensions v3_ca -out ca.crt -config /usr/local/etc/
cat ca.key | pulumi config set m3o:ca-key --secret
cat ca.crt | pulumi config set m3o:ca-crt --secret
rm ca.key ca.crt

## Run pulumi up

## Set config for the analytics service

password=$(pulumi config get analytics_db_password)
postgres="host=timescale.timescale user=analytics dbname=analytics sslmode=require password=$password"
micro config set analytics.postgres \$postgres

## Run the m3o services

micro run github.com/m3o/services/analytics;
micro run github.com/m3o/services/alert;
micro run github.com/m3o/services/billing;
micro run github.com/m3o/services/customers;
micro run github.com/m3o/services/emails;
micro run github.com/m3o/services/invite;
micro run github.com/m3o/services/namespaces;
micro run github.com/m3o/services/payments;
micro run github.com/m3o/services/platform;
micro run github.com/m3o/services/signup;
micro run github.com/m3o/services/status;
micro run github.com/m3o/services/subscriptions;
micro run github.com/m3o/services/usage;

## Connect to the cockroachdb cluster

kubectl exec ./cockroach sql --certs-dir=/certs --host=cockroach-cockroachdb.cockroach
