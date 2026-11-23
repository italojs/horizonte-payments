#!/bin/sh
set -eu
case "${1:-}" in accounts|banks) domain="$1";; *) echo 'Usage: check-project.sh accounts|banks' >&2; exit 2;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
db=$(docker run --rm -d -e POSTGRES_PASSWORD=fixture -p 127.0.0.1::5432 postgres:18)
cleanup() { docker rm -f "$db" >/dev/null; }
trap cleanup EXIT
attempt=0
until docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
  attempt=$((attempt+1))
  if [ "$attempt" -ge 60 ]; then echo 'Test database did not become ready.' >&2; exit 1; fi
  sleep 1
done
address=$(docker port "$db" 5432/tcp)
export TEST_DATABASE_URL="postgres://postgres:fixture@$address/postgres"
cd "$root/$domain"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:integration
