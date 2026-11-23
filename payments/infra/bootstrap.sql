CREATE ROLE payments_writer LOGIN PASSWORD 'local-payments-writer';
CREATE ROLE payments_reader LOGIN PASSWORD 'local-payments-reader';
CREATE DATABASE payments OWNER payments_writer;
REVOKE CONNECT ON DATABASE payments FROM PUBLIC;
GRANT CONNECT ON DATABASE payments TO payments_reader, payments_writer;
\connect payments
GRANT USAGE ON SCHEMA public TO payments_reader;
SET ROLE payments_writer;
\i /bootstrap/payments.sql
RESET ROLE;
GRANT SELECT ON payments, payment_events TO payments_reader;
