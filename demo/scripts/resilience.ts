import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { compose, origin, requireTestEnvironment } from './environment.ts';

requireTestEnvironment();
const dest = fileURLToPath(new URL('../evidence/resilience', import.meta.url));
const data: Record<string, unknown>[] = [];
const demo = (...args: string[]) =>
  execFileSync(process.execPath, [fileURLToPath(new URL('./operator.ts', import.meta.url)), ...args], { encoding: 'utf8' }).trim();
async function until<T>(poll: () => Promise<T | undefined>, message: string, ms = 90000) {
  const deadline = Date.now() + ms;
  do {
    const val = await poll();
    if (val !== undefined) return val;
    await wait(300);
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for ' + message);
}
await mkdir(dest, { recursive: true });
demo('reset', '--test');
const request = (path: string, init?: RequestInit) => fetch(origin + '/api' + path, init);
const post = (key: string, billRef = 'ipe-192') =>
  request('/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ billRef }),
  });
async function accept(key: string, bill?: string) {
  const res = await post(key, bill);
  assert.equal(res.status, 202);
  const { id } = (await res.json()) as { id: string };
  assert.match(id, /^[a-f0-9-]{36}$/);
  return id;
}
async function final(id: string) {
  return until(async () => {
    const response = await request('/payments/' + id);
    if (!response.ok) return undefined;
    const payment = (await response.json()) as {
      state: string;
      receipt: string | null;
      events: { eventType: string }[];
    };
    return ['CANCELLED', 'PAID', 'FAILED'].includes(payment.state) ? payment : undefined;
  }, id);
}
function effects(id: string) {
  const bank = JSON.parse(demo('bank', 'inspect', id));
  const { captures, releases, reserves } = JSON.parse(demo('accounts', 'inspect', id));
  return { paid: bank.paidEvents, receipt: bank.receipt, captures, releases, reserves };
}
async function balance() {
  const response = await request('/account');
  assert.equal(response.status, 200);
  return ((await response.json()) as { availableMinor: number }).availableMinor;
}
async function report(caseName: string, facts: Record<string, unknown>) {
  const result = { case: caseName, observedAt: new Date().toISOString(), ...facts };
  data.push(result);
  await writeFile(dest + '/checks.json', JSON.stringify(data, null, 2) + '\n');
  console.log(caseName, JSON.stringify(facts));
}
// Broker-first acceptance and deduplication under overlapping HTTP requests.
const key = randomUUID();
const start = performance.now();
const ids = await Promise.all(Array.from({ length: 16 }, () => accept(key)));
assert.equal(new Set(ids).size, 1);
const id = ids[0];
const first = await final(id);
assert.equal(first.state, 'PAID');
const totals = effects(id);
assert.equal(totals.captures, 1);
assert.equal(totals.paid, 1);
assert.equal((await post(key, 'atlas-483')).status, 409);
await report('concurrent-replay', {
  id,
  requests: 16,
  captures: totals.captures,
  bankPaid: totals.paid,
  elapsedMs: Math.round(performance.now() - start),
  conflict: 409,
});
for (const point of ['after-commit', 'after-provider']) {
  const baseline = await balance();
  demo('worker', 'failpoint', point);
  const created = await accept(randomUUID());
  const result = await final(created);
  assert.equal(result.state, 'PAID');
  const observed = effects(created);
  assert.equal(observed.captures, 1);
  assert.equal(observed.paid, 1);
  assert.equal(await balance(), baseline - 85000);
  const marker = compose('logs', '--no-color', 'payments-worker')
    .split('\n')
    .find(
      (line) =>
        line.includes('worker_failpoint_triggered') && line.includes(created) && line.includes(point),
    );
  assert(marker, 'The worker must have exited at the armed failpoint');
  await report(point, { id: created, state: result.state, ...observed, workerExit: 86 });
}
// Stop the HTTP provider itself. No request can reach it before its restart.
const opening = await balance();
let outageId = '';
compose('stop', '-t', '2', 'bank-simulator');
try {
  outageId = await accept(randomUUID(), 'atlas-483');
  const result = await final(outageId);
  assert.equal(result.state, 'CANCELLED');
  assert.equal(await balance(), opening);
  const history = result.events.map((e) => e.eventType);
  assert.equal(history.filter((e) => e === 'RETRY_SCHEDULED').length, 3);
  assert(history.includes('AUTOMATIC_CANCELLATION_SCHEDULED'));
  assert(history.includes('CANCELLED_BEFORE_SUBMISSION'));
  const observed = effects(outageId);
  assert.equal(observed.paid, 0);
  assert.equal(observed.releases, 1);
  // Check actual persisted hand-offs, including their broker destination.
  const routes = JSON.parse(demo('payment', 'routes', outageId)) as string[];
  assert.equal(routes.filter((q) => q === 'payments.retry').length, 3);
  assert(routes.includes('payments.cancel'));
  await report('automatic-cancellation-bank-stopped', {
    id: outageId,
    state: result.state,
    balanceBefore: opening,
    balanceAfter: await balance(),
    history,
    routes,
    ...observed,
  });
} finally {
  compose('start', 'bank-simulator');
}
// A confirmed message stays durable while no consumer is alive and the broker restarts.
compose('stop', '-t', '2', 'payments-worker');
const persisted = await accept(randomUUID());
try {
  compose('stop', '-t', '5', 'rabbitmq');
  const unavailable = await post(randomUUID());
  assert.equal(unavailable.status, 503);
  await report('broker-unavailable', { http: unavailable.status, previouslyAccepted: persisted });
} finally {
  compose('start', 'rabbitmq');
  compose('up', '-d', '--no-build', 'payments-worker');
}
const resumed = await final(persisted);
assert.equal(resumed.state, 'PAID');
const observed = effects(persisted);
assert.equal(observed.captures, 1);
assert.equal(observed.paid, 1);
await report('broker-restart', { id: persisted, state: resumed.state, ...observed });
// Pause a live connection after a confirmed publication. The next publish can reach the
// socket but cannot receive a broker confirm. Retry the same intent after unpausing.
await accept(key);
const uncertainKey = randomUUID();
const beforeUncertain = await balance();
compose('pause', 'rabbitmq');
let responseMs: number;
try {
  const started = performance.now();
  const uncertain = await post(uncertainKey);
  responseMs = Math.round(performance.now() - started);
  assert.equal(uncertain.status, 503);
  assert(responseMs < 12000);
} finally {
  compose('unpause', 'rabbitmq');
}
const recovered = await accept(uncertainKey);
assert.equal((await final(recovered)).state, 'PAID');
const recoveredEffects = effects(recovered);
assert.equal(recoveredEffects.paid, 1);
assert.equal(recoveredEffects.captures, 1);
assert.equal(await balance(), beforeUncertain - 85000);
await report('missing-publisher-confirm', {
  id: recovered,
  firstHttp: 503,
  responseMs,
  ...recoveredEffects,
});
// Simultaneous independent payments compete for the last available funds.
const available = await balance();
const amount = 300000;
const burst = await Promise.all(Array.from({ length: 4 }, () => accept(randomUUID(), 'atlas-483')));
const all = await Promise.all(burst.map(final));
const paid = all.filter((p) => p.state === 'PAID').length;
assert.equal(paid, Math.min(4, Math.floor(available / amount)));
assert(
  all.every((p) => p.state === 'PAID' || p.events.some((e) => e.eventType === 'INSUFFICIENT_FUNDS')),
);
assert.equal(await balance(), available - paid * amount);
await report('concurrent-funds', {
  requests: 4,
  paid,
  insufficient: 4 - paid,
  balanceBefore: available,
  balanceAfter: await balance(),
});
