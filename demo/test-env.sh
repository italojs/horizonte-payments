# Source only in a terminal dedicated to disposable end-to-end tests.
. ./demo/env.sh || return 1
export COMPOSE_PROJECT_NAME=horizonte-e2e
export WEB_PORT=15173 GRAFANA_PORT=13000 ACCOUNTS_PORT=13011 BANKS_PORT=13012
export RETRY_MS=1500,4000,8000 BREAKER_COOLDOWN_MS=2500 RECONCILE_MS=2500
export E2E_BASE_URL="http://localhost:$WEB_PORT" GRAFANA_URL="http://localhost:$GRAFANA_PORT"
export ALLOW_TEST_RESET=1 E2E_RESET=1 E2E_TELEMETRY_GRACE_MS=9000
export EVIDENCE_DIR="$PWD/demo/evidence/explorations"
