# Horizonte Banks

Banks simulates an external settlement provider. Each payment instruction has a stable UUID. The simulator persists its decision and bank receipt so callers can recover after an interrupted request.

## Run locally

Docker Compose builds the bank image and starts its own PostgreSQL 18 database.

```sh
docker compose up --build -d --wait
curl -s http://127.0.0.1:3012/health
```

Set `BANKS_PORT` to change the loopback host port. The database listens on the private Compose network and stores data in the `banks-data` volume.

## Build and release

```sh
docker build -t horizonte-banks:1.0.0 .
```

The default command runs the API as the `node` user on port 3012. To run against an existing simulator database, provide `BANK_DB` as a PostgreSQL connection URL reachable from the container. `HOST` and `PORT` override the API bind address and listening port. Startup applies the idempotent schema, preserving payment instructions, bank events, receipts and the active simulator mode.

Local development uses Node.js 24 or later and pnpm 10.25.0.

```sh
pnpm install --frozen-lockfile
export BANK_DB=postgres://localhost/bank
pnpm start
```

## Verify

```sh
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgres://localhost/banks_test pnpm test:integration
```

Create the disposable test database first. The integration suite creates and removes a random schema. It exercises pending settlement, rejection, early cancellation, concurrent submissions, a socket disconnect after a committed payment and receipt recovery.

## Operate

Change the mode through the simulator operator CLI. The choice applies to all callers and persists across process restarts.

```sh
docker compose exec -T bank-simulator node backend/scripts/operator.ts mode lose-response
docker compose exec -T bank-simulator node backend/scripts/operator.ts inspect 418827fa-5977-4918-ab8a-dabb597f14fa
```

| Mode | Behavior |
| --- | --- |
| normal | Accept a new submission or settle an existing processing instruction. |
| offline | Respond to submit, query and cancel with HTTP 503. |
| pending | Keep active submissions in PROCESSING until cancellation or a mode change. |
| lose-response | Commit a paid submit, close that connection before replying, then return to normal mode. |
| reject | Reject new and processing instructions. |

Inspection returns JSON with `id`, `status`, `receipt` and `paidEvents`. An unknown ID has null status and receipt, with zero paid events. On a disposable database, `docker compose exec -T -e ALLOW_TEST_RESET=1 bank-simulator node backend/scripts/operator.ts reset --test` clears all bank events and payments and restores normal mode.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP collector URL to export telemetry. The default service name is `bank-simulator`. Bank operations emit `bank.submit`, `bank.query` and `bank.cancel` spans, structured logs and the `banks.operations` counter. `payment.id` correlates spans and logs across services.

HTTP routes live in `backend/src/server/routes`, handlers in `backend/src/server/controllers`, settlement decisions in `services`, and persistence in `db/repositories` under `backend/src`. Database migrations live in `database/migrations`. See the [Banks HTTP contract](docs/http-contract.md).
