# Testing and recording

## Project-owned tests

Use Node 24+, pnpm 10 and Docker Compose. Each project runs against its own dependencies. From the top-level directory, `source demo/env.sh` selects the configured local Docker engine on the demo Mac. Each provider test below creates and removes a disposable PostgreSQL container. You can instead supply your own disposable database as `TEST_DATABASE_URL` and run the commands documented by that provider.

```sh
./demo/scripts/check-project.sh accounts
./demo/scripts/check-project.sh banks
pnpm --dir payments install --frozen-lockfile
pnpm --dir payments typecheck
pnpm --dir payments test
pnpm --dir payments test:integration
(cd payments/frontend && pnpm --ignore-workspace install --frozen-lockfile && pnpm build)
```

Payments' Vitest tests exercise request mapping, idempotency and the state machine. Its Testcontainers tests exercise real command receipts, concurrency and RabbitMQ scheduled delivery. Accounts and Banks test their own HTTP contracts and transaction invariants against PostgreSQL. Each provider is executable on its own without a customer UI.

## Disposable end-to-end environment

Use a separate terminal. These commands give the tests dedicated container names, volumes and ports. The test reset stops consumers, discards queued deliveries and asks *each owner* to reset its fixtures. It restores a BRL 10,000 account before each scenario. Keep this terminal separate from the presentation terminal.

```sh
source demo/test-env.sh
docker compose build
docker compose up -d --no-build --wait
pnpm --dir demo install --frozen-lockfile
(cd payments/frontend && pnpm exec playwright install chromium)
node demo/scripts/boundaries.ts
pnpm --dir demo resilience
pnpm --dir payments/frontend e2e
```

The boundary probes run **inside** the API, worker and both provider containers. They inspect the destination of each configured database connection, test provider HTTP access and verify that foreign database hostnames cannot be resolved. Fault injection then tests worker crashes before ACK, a stopped bank, duplicate instructions, missing broker confirmations, a broker restart and concurrent spending. The web tests run at [localhost:15173](http://localhost:15173) and the disposable Grafana runs at [localhost:13000](http://localhost:13000).

## Verify independent releases

Run `./demo/scripts/independent-releases.sh` from a shell with Docker access. It starts Accounts, Banks and Payments under three different Compose project names and publishes them on temporary ports. Only their application-facing containers join a shared HTTP network. The script replaces the Payments worker with two replicas, checks both provider container IDs, submits a bill through the web proxy and verifies settlement and the final balance. It then removes its three disposable stacks. [Recorded result](../evidence/boundaries/independent-release.json)

## Browser explorations and OpenTelemetry recordings

1. Start the disposable environment as above and run the full browser suite. Four charters write JSON observations and continuous WebM video to `demo/evidence/explorations`. The mobile success and provider rejection cases are additional automated checks.
2. Install FFmpeg and ffprobe on your machine. If Chromium's video encoder is missing, install Playwright's Chromium bundle in the frontend and the demo tools. Both use the same Playwright version.
3. Run the commands below before removing the disposable stack. The telemetry script opens **real Grafana Explore pages** and checks the assertions before saving the video. Tempo must show all four services and the parent chain from capture to the worker and API. Loki must return records for the same trace. Prometheus counters are aggregate series grouped by domain operation.

```sh
id=$(node -p 'require("./demo/evidence/explorations/01-provider-response-lost.json").id')
pnpm --dir demo telemetry "$id"
pnpm --dir demo evidence
```

The catalog converts the browser captures to MP4, checks their media and hashes, and requires the first payment ID to match both Grafana recordings. Grafana trace data is subject to retention. The videos and manifests can be viewed offline.

To check scaling, start two APIs and three workers in this test stack, run the success/payment spec, and then restore one replica of each using the following commands.

```sh
docker compose up -d --no-deps --scale payments-api=2 --scale payments-worker=3 payments-api payments-worker
pnpm --dir payments/frontend exec playwright test e2e/payments.spec.ts
docker compose up -d --no-deps --scale payments-api=1 --scale payments-worker=1 payments-api payments-worker
```

When finished with the **disposable** project, `docker compose down --volumes` in the test terminal deletes its fixture data. The ordinary local demo has separate volumes.
