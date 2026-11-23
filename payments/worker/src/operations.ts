import type { Pool } from 'pg';
import { connectBroker, queues } from '@horizonte/payments-runtime/broker';
import { reviewCommand } from './db/repositories/paymentCommands.ts';

export async function failpoint(pool: Pool, name: string, paymentId: string) {
  // This one-shot deletion commits independently of the transaction intentionally killed below.
  const { rowCount } = await pool.query(
    `DELETE FROM worker_failpoints WHERE name=$1 AND expires_at>clock_timestamp()
    AND (payment_id IS NULL OR payment_id=$2) RETURNING name`,
    [name, paymentId],
  );
  if (rowCount) {
    console.log(JSON.stringify({ event: 'worker_failpoint_triggered', name, paymentId, exit: 86 }));
    process.exit(86);
  }
}

export async function arm(pool: Pool) {
  const [name, paymentId, seconds] = process.argv.slice(3);
  const ttl = Number(seconds ?? 60);
  if (
    !['after-provider', 'after-commit'].includes(name) ||
    !Number.isSafeInteger(ttl) ||
    ttl <= 0 ||
    ttl > 3600
  )
    throw new Error(
      'Usage: worker/src/index.ts failpoint after-provider|after-commit [payment-uuid|*] [ttl-seconds 1..3600]',
    );
  await pool.query(
    `INSERT INTO worker_failpoints(name,payment_id,expires_at) VALUES ($1,$2,clock_timestamp()+$3*interval '1 second')
    ON CONFLICT(name) DO UPDATE SET payment_id=excluded.payment_id, expires_at=excluded.expires_at`,
    [name, paymentId === '*' ? null : (paymentId ?? null), ttl],
  );
  console.log(
    JSON.stringify({ event: 'worker_failpoint_armed', name, paymentId: paymentId || '*', ttl }),
  );
}

export async function redrive(pool: Pool) {
  const [paymentId, companyId] = process.argv.slice(3);
  if (!paymentId) throw new Error('Usage: worker/src/index.ts redrive <payment-uuid> [company-id]');
  const command = await reviewCommand(pool, paymentId, companyId);
  if (!command) throw new Error('No active operator review matches this payment and tenant');
  const broker = await connectBroker(undefined, { declare: false });
  try {
    await broker.publish(queues.process, command);
    console.log(
      JSON.stringify({
        event: 'redrive_confirmed',
        paymentId,
        companyId: command.companyId,
        commandId: command.id,
      }),
    );
  } finally {
    await broker.close();
  }
}
