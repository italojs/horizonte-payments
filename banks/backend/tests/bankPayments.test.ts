import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Pool } from 'pg';
import { createServer } from '../src/server/index.ts';
import { decideBank } from '../src/services/settlement.ts';

test('a pending submission settles or rejects according to the current mode', () => {
  assert.equal(decideBank('submit', null, 'pending'), 'PROCESSING');
  assert.equal(decideBank('query', 'PROCESSING', 'normal'), 'PAID');
  assert.equal(decideBank('query', 'PROCESSING', 'reject'), 'REJECTED');
  assert.equal(decideBank('cancel', 'PROCESSING', 'normal'), 'CANCELLED');
  assert.equal(decideBank('query', null, 'normal'), null);
});

test('paid, rejected and cancelled instructions remain final on replay', () => {
  for (const state of ['PAID', 'REJECTED', 'CANCELLED'] as const) {
    for (const action of ['submit', 'cancel', 'query'] as const) {
      assert.equal(decideBank(action, state, 'normal'), state);
    }
  }
  assert.equal(decideBank('submit', null, 'lose-response'), 'PAID');
  assert.equal(decideBank('cancel', null, 'normal'), 'CANCELLED');
});

test('HTTP validates commands and keeps simulator control off the API', async () => {
  const pool = new Pool();
  const app = createServer(pool);
  try {
    assert.deepEqual((await app.inject('/health')).json(), { ok: true });
    assert.equal(
      (await app.inject({ method: 'POST', url: '/submit', payload: {} })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/mode', payload: { mode: 'offline' } })).statusCode,
      404,
    );
  } finally {
    await app.close();
    await pool.end();
  }
});

test('CLI requires reset opt-in and rejects unknown modes before connecting', () => {
  const options = {
    env: { ...process.env, ALLOW_TEST_RESET: '', BANK_DB: '' },
    encoding: 'utf8' as const,
  };
  const reset = spawnSync(
    process.execPath,
    ['backend/scripts/operator.ts', 'reset', '--test'],
    options,
  );
  assert.equal(reset.status, 1);
  assert.match(reset.stderr, /ALLOW_TEST_RESET=1/);
  const badMode = spawnSync(
    process.execPath,
    ['backend/scripts/operator.ts', 'mode', 'wrong'],
    options,
  );
  assert.equal(badMode.status, 1);
  assert.match(badMode.stderr, /Usage/);
});
