import { database, transaction } from '../src/db/connection.ts';
import { inspect } from '../src/db/repositories/accounts.ts';
import { uuidPattern } from '../src/server/operation.ts';

async function run() {
  const [action, value, ...extra] = process.argv.slice(2);
  const inspecting = action === 'inspect' && new RegExp(uuidPattern).test(value ?? '');
  const resetting = action === 'reset' && value === '--test';
  if (extra.length || (!inspecting && !resetting))
    throw Error('Usage: operator.ts inspect UUID | reset --test');
  if (resetting && process.env.ALLOW_TEST_RESET !== '1')
    throw Error('Test reset requires ALLOW_TEST_RESET=1');

  const pool = database();
  try {
    if (inspecting) return await inspect(pool, value!);
    await transaction(pool, async (client) => {
      await client.query('LOCK TABLE accounts IN ACCESS EXCLUSIVE MODE');
      await client.query('TRUNCATE reservations, account_entries RESTART IDENTITY');
      await client.query('UPDATE accounts SET balance_minor = 1000000, reserved_minor = 0');
    });
    return { reset: true };
  } finally {
    await pool.end();
  }
}

try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operator command failed');
  process.exitCode = 1;
}
