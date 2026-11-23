# Payments

Payments accepts a bill payment or cancellation for the Horizonte demo account. Its independent worker coordinates two pre-existing HTTP services. The API acknowledges a request once RabbitMQ confirms routing. The worker owns financial progress and recovery. Accounts supplies the balance and Banks supplies the settlement result.

| Directory | Responsibility |
|---|---|
| `backend/src/server/routes` and `backend/src/server/controllers` | Fastify routes, validation, request/response mapping |
| `backend/src/services`, `clients` and `db/repositories` | Accept commands, publish to RabbitMQ, read the balance over HTTP and query payment history |
| `backend/runtime` | Payments-only transport, database connection and OpenTelemetry instrumentation used by API and worker |
| `worker/src/services`, `domain`, `clients` and `db/repositories` | Saga decisions, durable state transitions, HTTP integration and shared circuit state |
| `frontend/src/pages`, `components` and `services` | Bill review, submission, unified available balance, payment history and receipt |
| `infra` | Payments schema and broker setup |
| `backend/tests`, `worker/tests` and `frontend/e2e` | API behavior, state machine, persistence, RabbitMQ recovery and browser journeys |

## Run independently

From this project directory, point both provider addresses at HTTP endpoints reachable **from the containers**. On Docker Desktop an independently running provider published to the host can usually be reached via `host.docker.internal`. The integrated demo supplies service DNS on a common HTTP network.

```sh
export ACCOUNTS_URL=http://accounts.example.internal:3011
export BANK_URL=http://banks.example.internal:3012
docker compose build
docker compose up -d --no-build --wait
docker compose up -d --no-deps --scale payments-api=2 --scale payments-worker=3 payments-api payments-worker
```

The UI listens at [localhost:5173](http://localhost:5173) and proxies requests to the API. The database and broker use private volumes. Scale consumers and HTTP replicas independently according to queue depth and request traffic. The single-node local profile demonstrates persistence and replay. Capacity targets, replication, backup recovery and real-provider guarantees require separate validation for production.

## Public API

| Request | Result |
|---|---|
| `GET /api/account` | Available balance in minor currency units and the currency code |
| `GET /api/bills` | Supported bills with bill reference, beneficiary, amount and currency |
| `POST /api/payments` | Accepts `{"billRef":"atlas-483"}` with header `Idempotency-Key` and returns HTTP 202 with the payment ID after broker confirmation |
| `GET /api/payments` | Recent payments for the demo company |
| `GET /api/payments/:id` | Current state, audit events and the provider receipt when available |
| `POST /api/payments/:id/cancel` | Accepts a cancellation command for an eligible payment |

A client can receive a transient 404 between acceptance and the worker's first transaction. On a timeout or uncertain acceptance, repeat the original request with the same key. Reusing a key with different financial fields conflicts with the original decision. Fresh keys describe independent instructions.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:integration
cd frontend
pnpm --ignore-workspace install --frozen-lockfile
pnpm build
```

The integration suite starts PostgreSQL and RabbitMQ fixtures via Testcontainers. See [workflow, failure recovery and audit](docs/workflow.md) for the transaction boundaries, queue roles and operator tools.
