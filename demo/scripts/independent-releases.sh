#!/bin/sh
# Deploy three separate Compose projects. Only their HTTP-facing processes share a network.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
prefix="horizonte-release-check-$$"
export CONTRACT_NETWORK="$prefix-http"
export WEB_PORT=0 ACCOUNTS_PORT=0 BANKS_PORT=0
unset COMPOSE_FILE COMPOSE_PROJECT_NAME OTEL_EXPORTER_OTLP_ENDPOINT ACCOUNTS_URL BANK_URL
project() {
  domain=$1
  shift
  docker compose --project-name "$prefix-$domain" -f "$root/$domain/compose.yaml" -f "$root/demo/overrides/shared-http.yaml" "$@"
}
cleanup() {
  for name in payments banks accounts; do project "$name" down --volumes >/dev/null 2>&1 || true; done
  docker network rm "$CONTRACT_NETWORK" >/dev/null 2>&1 || true
}
docker network create "$CONTRACT_NETWORK" >/dev/null
trap cleanup EXIT
for name in accounts banks payments; do project "$name" up -d --build --wait; done
accounts_id=$(project accounts ps -q accounts-service)
banks_id=$(project banks ps -q bank-simulator)
worker_id=$(project payments ps -q payments-worker)
project payments up -d --no-build --no-deps --force-recreate --scale payments-worker=2 payments-worker
test "$accounts_id" = "$(project accounts ps -q accounts-service)"
test "$banks_id" = "$(project banks ps -q bank-simulator)"
test 2 -eq "$(project payments ps -q payments-worker | wc -l)"
address=$(project payments port web 5173)
ORIGIN="http://$address" EVIDENCE="$root/demo/evidence/boundaries/independent-release.json" \
ACCOUNTS_ID="$accounts_id" BANKS_ID="$banks_id" OLD_WORKER="$worker_id" \
NEW_WORKERS="$(project payments ps -q payments-worker)" node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
const url = process.env.ORIGIN + '/api';
const result = await fetch(url+'/payments', { method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()}, body:JSON.stringify({billRef:'ipe-192'}) });
assert.equal(result.status,202);
const {id} = await result.json();
let payment;
for(let i=0;i<100;i++) {
  const response=await fetch(url+'/payments/'+id);
  if(response.ok) payment=await response.json();
  if(payment?.state==='PAID') break;
  await wait(250);
}
assert.equal(payment?.state,'PAID');
assert.match(payment.receipt,/^B-/);
const account=await (await fetch(url+'/account')).json();
assert.equal(account.availableMinor,915000);
const workers=process.env.NEW_WORKERS.trim().split(/\s+/);
assert(!workers.includes(process.env.OLD_WORKER));
const evidence={checkedAt:new Date().toISOString(),independentComposeProjects:3,
  unchangedProviderContainers:{accounts:process.env.ACCOUNTS_ID,banks:process.env.BANKS_ID},
  oldWorker:process.env.OLD_WORKER,newWorkers:workers,paymentId:id,receipt:payment.receipt,
  state:payment.state,availableMinor:account.availableMinor};
await mkdir(dirname(process.env.EVIDENCE),{recursive:true});
await writeFile(process.env.EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
console.log('Payments-only release verified with two new workers, the same running providers and a paid bill.');
JS
