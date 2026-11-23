import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Pool } from 'pg';
import { decideReservation } from '../src/services/reservation.ts';
import { createServer } from '../src/server/index.ts';

test('a hold reduces spendable funds until a single capture or release', () => {
  assert.deepEqual(decideReservation('reserve', null, 80, 100), {
    code: 200,
    status: 'HELD',
    reservedDelta: 80,
    balanceDelta: 0,
  });
  assert.equal(decideReservation('reserve', null, 80, 20).code, 422);
  assert.deepEqual(decideReservation('capture', 'HELD', 80, 20), {
    code: 200,
    status: 'CAPTURED',
    reservedDelta: -80,
    balanceDelta: -80,
  });
  assert.deepEqual(decideReservation('capture', 'CAPTURED', 80, 20), {
    code: 200,
    status: 'CAPTURED',
    reservedDelta: 0,
    balanceDelta: 0,
  });
  assert.deepEqual(decideReservation('release', 'HELD', 80, 20), {
    code: 200,
    status: 'RELEASED',
    reservedDelta: -80,
    balanceDelta: 0,
  });
});

test('an early release fences a late reserve or capture', () => {
  assert.equal(decideReservation('release', null, 0, 100).status, 'RELEASED');
  assert.equal(decideReservation('reserve', 'RELEASED', 80, 100).reservedDelta, 0);
  assert.equal(decideReservation('capture', 'RELEASED', 80, 100).code, 409);
  assert.equal(decideReservation('release', 'CAPTURED', 80, 20).code, 409);
});

test('HTTP rejects malformed operations and exposes health', async () => {
  const pool = new Pool();
  const app = createServer(pool);
  try {
    assert.deepEqual((await app.inject('/health')).json(), { ok: true });
    const response = await app.inject({
      method: 'POST',
      url: '/reserve',
      payload: { paymentId: 'wrong', companyId: 'one' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/reset' })).statusCode, 404);
  } finally {
    await app.close();
    await pool.end();
  }
});

test('CLI requires an explicit reset opt-in before opening a database', () => {
  const command = spawnSync(process.execPath, ['backend/scripts/operator.ts', 'reset', '--test'], {
    env: { ...process.env, ALLOW_TEST_RESET: '', ACCOUNTS_DB: '' },
    encoding: 'utf8',
  });
  assert.equal(command.status, 1);
  assert.match(command.stderr, /ALLOW_TEST_RESET=1/);
});
