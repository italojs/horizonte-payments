import { database, transaction } from '../src/db/connection.ts';
import { inspect, modes } from '../src/db/repositories/bankPayments.ts';
import { uuidPattern } from '../src/server/operation.ts';

async function run() {
  const [action, value, ...extra] = process.argv.slice(2);
  const inspecting = action === 'inspect' && new RegExp(uuidPattern).test(value ?? '');
  const settingMode = action === 'mode' && modes.some((mode) => mode === value);
  const resetting = action === 'reset' && value === '--test';
  if (extra.length || (!inspecting && !settingMode && !resetting)) {
    throw Error('Usage: operator.ts inspect UUID | mode ' + modes.join('|') + ' | reset --test');
  }
  if (resetting && process.env.ALLOW_TEST_RESET !== '1')
    throw Error('Test reset requires ALLOW_TEST_RESET=1');

  const pool = database();
  try {
    if (inspecting) return await inspect(pool, value!);
    if (settingMode) {
      await pool.query('UPDATE simulator_control SET mode = $1 WHERE id = true', [value]);
      return { bankMode: value };
    }
    await transaction(pool, async (client) => {
      await client.query('TRUNCATE bank_events, bank_payments RESTART IDENTITY');
      await client.query("UPDATE simulator_control SET mode = 'normal' WHERE id = true");
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
