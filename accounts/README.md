# Horizonte Accounts

Accounts owns spendable balances, reservations and the account ledger. The API reserves funds for a payment, captures a hold once, and releases funds on cancellation. A fresh database starts with the `horizonte` company, account `acc-horizonte` and a BRL 10,000.00 balance.

## Run locally

From this directory, Docker Compose builds the Accounts image and starts its own PostgreSQL 18 database.

```sh
docker compose up --build -d --wait
curl -s http://127.0.0.1:3011/accounts/horizonte
```

The response contains `{"id":"acc-horizonte","availableMinor":1000000,"currency":"BRL"}`. Set `ACCOUNTS_PORT` to change the host port. The database listens on the private Compose network and stores data in the `accounts-data` volume.

## Build and release

```sh
docker build -t horizonte-accounts:1.0.0 .
```

The default image command runs the API as the `node` user on port 3011. To run against an existing Accounts database, provide `ACCOUNTS_DB` as a PostgreSQL connection URL reachable from the container. `HOST` and `PORT` override the API bind address and listening port. The application applies its idempotent schema at startup. Existing account rows, reservations and entries retain their values.

Local development uses Node.js 24 or later and pnpm 10.25.0. Start from the Accounts project directory.

```sh
pnpm install --frozen-lockfile
export ACCOUNTS_DB=postgres://localhost/accounts
pnpm start
```

## Verify

```sh
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgres://localhost/accounts_test pnpm test:integration
```

Create the disposable test database first. Integration tests create and remove a random schema in that database. They invoke the HTTP routes and operator CLI, including competing reservations, duplicate capture, early release and replay after schema initialization.

## Operate

Use the simulator CLI inside the running service to count ledger effects for a payment.

```sh
docker compose exec -T accounts-service node backend/scripts/operator.ts inspect 418827fa-5977-4918-ab8a-dabb597f14fa
```

Inspection returns JSON with `status`, `account`, `amountMinor`, `reserves`, `captures` and `releases`. For an unknown ID the first three fields are null and the counts are zero. On a disposable database, `docker compose exec -T -e ALLOW_TEST_RESET=1 accounts-service node backend/scripts/operator.ts reset --test` removes all reservations and ledger entries and restores every account to 1,000,000 minor units.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the URL of an OTLP/HTTP collector to export telemetry. The default service name is `accounts-service`. Operations emit `accounts.reserve`, `accounts.capture` and `accounts.release` spans, structured logs and the `accounts.operations` counter. `payment.id` correlates spans and logs across services.

HTTP routes live in `backend/src/server/routes`, handlers in `backend/src/server/controllers`, account decisions in `services`, and persistence in `db/repositories` under `backend/src`. The initial database migration lives in `database/migrations`. See the [Accounts HTTP contract](docs/http-contract.md).
