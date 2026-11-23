import { database, transaction } from '../runtime/database.ts';

const [action, argument] = process.argv.slice(2);
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const pool = database('PAYMENTS_DB');

async function run() {
  if (action === 'reset' && argument === '--test') {
    if (process.env.ALLOW_TEST_RESET !== '1')
      throw new Error('Test reset requires ALLOW_TEST_RESET=1');
    await transaction(pool, async (db) => {
      await db.query(
        'TRUNCATE command_receipts, early_cancellations, payment_events, payments, worker_failpoints RESTART IDENTITY',
      );
      await db.query(
        'UPDATE bank_breaker SET failures=0, open_until=NULL, probe=NULL, probe_until=NULL, generation=generation+1',
      );
    });
    return { reset: true };
  }
  if (action === 'breaker') {
    const { rows } =
      await pool.query(`SELECT name AS provider, failures, probe_until AS "probeUntil", open_until AS "openUntil",
      CASE WHEN open_until IS NULL THEN 'CLOSED' WHEN open_until>clock_timestamp() THEN 'OPEN' ELSE 'HALF_OPEN' END AS state
      FROM bank_breaker WHERE name='provider'`);
    return rows[0];
  }
  if (!['inspect', 'routes'].includes(action) || !uuid.test(argument ?? '')) {
    throw new Error('Usage: operator.ts inspect <uuid> | routes <uuid> | breaker | reset --test');
  }
  if (action === 'routes') {
    const { rows } = await pool.query(
      `SELECT successor->>'queue' AS queue FROM command_receipts
      WHERE payment_id=$1 AND successor IS NOT NULL ORDER BY decided_at, command_id`,
      [argument],
    );
    return rows.map((row) => row.queue);
  }
  const { rows } = await pool.query(
    `SELECT id, company_id AS "companyId", account_id AS "accountId", state, version, attempt,
    review_required AS "reviewRequired", submission_intent AS "submissionIntent", provider_ref AS receipt,
    bill_ref AS "billRef", currency, amount_minor AS "amountMinor", beneficiary_ref AS "beneficiaryRef",
    created_at AS "createdAt", updated_at AS "updatedAt", cancel_reason AS "cancelReason",
    COALESCE((SELECT json_agg(json_build_object('createdAt', e.created_at, 'eventType', e.event_type,
      'actor', e.actor, 'detail', e.detail, 'state', e.state, 'version', e.version) ORDER BY e.id)
      FROM payment_events e WHERE e.payment_id=p.id AND e.company_id=p.company_id), '[]') AS events
    FROM payments p WHERE id=$1`,
    [argument],
  );
  if (!rows[0]) return { payment: null, state: null, version: null, attempt: null, events: [] };
  const { events, ...row } = rows[0];
  const payment = { ...row, amountMinor: Number(row.amountMinor) };
  return { ...payment, payment, events };
}
try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operator command failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
