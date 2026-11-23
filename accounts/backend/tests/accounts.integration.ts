import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createServer } from '../src/server/index.ts';
import { migrate } from '../src/db/migrate.ts';
import { testDatabase } from './database.ts';

test('HTTP operations maintain the ledger across replay, restart and competing accounts', async (t) => {
  const { pool, operator, close } = await testDatabase();
  const app = createServer(pool);
  t.after(async () => {
    await app.close();
    await close();
  });
  const company = 'horizonte';
  const paymentId = randomUUID();
  const body = {
    paymentId,
    companyId: company,
    accountId: 'acc-horizonte',
    currency: 'BRL',
    amountMinor: 1200,
  };
  const post = (action: string, overrides = {}) =>
    app.inject({ method: 'POST', url: '/' + action, payload: { ...body, ...overrides } });
  const account = async () => (await app.inject('/accounts/horizonte')).json();

  assert.deepEqual((await app.inject('/accounts/missing')).json(), { error: 'Unknown account' });
  assert.equal((await account()).availableMinor, 1000000);
  assert.deepEqual(operator('inspect', paymentId), {
    account: null,
    amountMinor: null,
    captures: 0,
    reserves: 0,
    releases: 0,
    status: null,
  });
  assert.equal((await post('reserve', { currency: 'USD' })).statusCode, 400);
  assert.equal((await post('reserve', { accountId: 'wrong' })).statusCode, 404);
  assert.deepEqual((await post('reserve', { amountMinor: 1000001 })).json(), {
    status: 'INSUFFICIENT_FUNDS',
  });

  const reserves = await Promise.all(Array.from({ length: 10 }, () => post('reserve')));
  assert.ok(
    reserves.every((response) => response.statusCode === 200 && response.json().status === 'HELD'),
  );
  assert.equal((await account()).availableMinor, 998800);
  assert.equal((await post('reserve', { amountMinor: 2400 })).statusCode, 409);
  await migrate(pool);
  const captures = await Promise.all(Array.from({ length: 10 }, () => post('capture')));
  assert.ok(captures.every((response) => response.json().status === 'CAPTURED'));
  assert.deepEqual(operator('inspect', paymentId), {
    account: 'acc-horizonte',
    amountMinor: 1200,
    captures: 1,
    reserves: 1,
    releases: 0,
    status: 'CAPTURED',
  });
  assert.equal((await post('release')).statusCode, 409);
  assert.equal((await account()).availableMinor, 998800);

  const early = randomUUID();
  assert.equal((await post('release', { paymentId: early })).json().status, 'RELEASED');
  assert.equal((await post('reserve', { paymentId: early })).json().status, 'RELEASED');
  assert.equal((await post('capture', { paymentId: early })).statusCode, 409);
  assert.equal(operator('inspect', early).reserves, 0);

  const held = randomUUID();
  await post('reserve', { paymentId: held });
  await Promise.all([post('release', { paymentId: held }), post('release', { paymentId: held })]);
  assert.equal(operator('inspect', held).releases, 1);
  assert.equal((await account()).availableMinor, 998800);

  await pool.query(
    "INSERT INTO accounts (id,company_id,currency,balance_minor) VALUES ('acc-two','two','BRL',2000)",
  );
  const collision = randomUUID();
  const concurrent = await Promise.all([
    post('reserve', { paymentId: collision }),
    post('reserve', {
      paymentId: collision.toUpperCase(),
      companyId: 'two',
      accountId: 'acc-two',
    }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 404]);
  assert.equal(operator('inspect', collision).reserves, 1);

  const budget = await Promise.all([
    post('reserve', { paymentId: randomUUID(), amountMinor: 600000 }),
    post('reserve', { paymentId: randomUUID(), amountMinor: 600000 }),
  ]);
  assert.deepEqual(budget.map((r) => r.statusCode).sort(), [200, 422]);
  assert.deepEqual(operator('reset', '--test'), { reset: true });
  assert.equal((await account()).availableMinor, 1000000);
  assert.equal(operator('inspect', paymentId).status, null);
});
