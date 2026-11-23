import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { migrate } from '../src/db/migrate.ts';
import { createServer } from '../src/server/index.ts';
import { testDatabase } from './database.ts';

test('settlement survives lost HTTP responses, replay, restarts and cancellation', async (t) => {
  const { pool, operator, close } = await testDatabase();
  const app = createServer(pool);
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    await app.close();
    await close();
  });
  const paymentId = randomUUID();
  const body = {
    paymentId,
    companyId: 'horizonte',
    amountMinor: 5000,
    currency: 'BRL',
    beneficiaryRef: 'opaque-ref',
  };
  const post = (action: string, overrides = {}) =>
    app.inject({ method: 'POST', url: '/' + action, payload: { ...body, ...overrides } });
  const query = (id: string, company = 'horizonte') =>
    app.inject('/payments/' + id + '?companyId=' + company);

  assert.equal((await query(paymentId)).statusCode, 404);
  assert.deepEqual(operator('inspect', paymentId), {
    id: paymentId,
    receipt: null,
    paidEvents: 0,
    status: null,
  });
  assert.equal((await post('submit', { beneficiaryRef: '' })).statusCode, 400);
  assert.deepEqual(operator('mode', 'offline'), { bankMode: 'offline' });
  assert.equal((await query(paymentId)).statusCode, 503);
  assert.equal((await post('submit')).statusCode, 503);
  operator('mode', 'lose-response');
  await assert.rejects(
    fetch(origin + '/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    /fetch failed/,
  );
  const settled = (await query(paymentId)).json();
  assert.equal(settled.status, 'PAID');
  assert.match(settled.receipt, /^B-/);
  await migrate(pool);
  const replay = await Promise.all(Array.from({ length: 12 }, () => post('submit')));
  assert.ok(
    replay.every(
      (response) => response.statusCode === 200 && response.json().receipt === settled.receipt,
    ),
  );
  assert.deepEqual((await post('cancel')).json(), settled);
  assert.deepEqual(operator('inspect', paymentId), { ...settled, id: paymentId, paidEvents: 1 });
  assert.equal((await post('submit', { beneficiaryRef: 'changed' })).statusCode, 409);
  assert.equal((await post('submit', { amountMinor: 5001 })).statusCode, 409);
  assert.equal((await query(paymentId, 'another-company')).statusCode, 404);

  operator('mode', 'pending');
  const pending = randomUUID();
  assert.equal((await post('submit', { paymentId: pending })).json().status, 'PROCESSING');
  assert.equal((await query(pending)).json().status, 'PROCESSING');
  operator('mode', 'normal');
  assert.equal((await query(pending)).json().status, 'PAID');
  assert.equal(operator('inspect', pending).paidEvents, 1);

  const cancelled = randomUUID();
  assert.equal((await post('cancel', { paymentId: cancelled })).json().status, 'CANCELLED');
  assert.equal((await post('submit', { paymentId: cancelled })).json().status, 'CANCELLED');
  assert.equal(operator('inspect', cancelled).paidEvents, 0);

  const concurrent = randomUUID();
  const results = await Promise.all([
    post('submit', { paymentId: concurrent }),
    post('submit', { paymentId: concurrent.toUpperCase() }),
  ]);
  assert.deepEqual(results[0].json(), results[1].json());
  assert.equal(operator('inspect', concurrent).paidEvents, 1);

  operator('mode', 'reject');
  const rejected = randomUUID();
  const denial = await post('submit', { paymentId: rejected });
  assert.equal(denial.statusCode, 422);
  assert.equal(denial.json().status, 'REJECTED');
  operator('mode', 'normal');
  assert.equal((await query(rejected)).statusCode, 422);
  assert.equal(operator('inspect', rejected).paidEvents, 0);
  assert.deepEqual(operator('reset', '--test'), { reset: true });
  assert.equal(operator('inspect', paymentId).status, null);
  assert.equal((await post('submit')).json().status, 'PAID');
});
