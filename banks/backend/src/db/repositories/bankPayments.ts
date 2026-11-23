import type { Pool, PoolClient } from 'pg';
import type { Operation } from '../../types/operation.ts';
import type { BankState } from '../../services/settlement.ts';

interface PaymentRow {
  company_id: string;
  amount_minor: string | null;
  currency: string | null;
  beneficiary_ref: string | null;
  status: BankState;
  receipt: string | null;
}

export const modes = ['normal', 'offline', 'pending', 'lose-response', 'reject'] as const;
export type BankMode = (typeof modes)[number];

export async function lockPayment(client: PoolClient, paymentId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
    paymentId,
  ]);
}

export async function currentMode(client: PoolClient) {
  const { rows } = await client.query<{ mode: BankMode }>(
    'SELECT mode FROM simulator_control WHERE id = true',
  );
  return rows[0].mode;
}

export async function findPayment(client: PoolClient, paymentId: string) {
  const { rows } = await client.query<PaymentRow>(
    'SELECT company_id, amount_minor, currency, beneficiary_ref, status, receipt FROM bank_payments WHERE payment_id = $1',
    [paymentId],
  );
  return rows[0];
}

export async function recordTransition(
  client: PoolClient,
  operation: Operation,
  status: BankState,
  receipt: string | null,
) {
  const { paymentId, companyId, amountMinor, currency, beneficiaryRef } = operation;
  await client.query(
    `INSERT INTO bank_payments(payment_id, company_id, amount_minor, currency, beneficiary_ref, status, receipt)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (payment_id) DO UPDATE SET status = excluded.status, receipt = excluded.receipt`,
    [paymentId, companyId, amountMinor, currency, beneficiaryRef, status, receipt],
  );
  await client.query('INSERT INTO bank_events(payment_id, event_type) VALUES ($1,$2)', [
    paymentId,
    status,
  ]);
}

export async function consumeLostResponse(client: PoolClient) {
  const { rowCount } = await client.query(
    "UPDATE simulator_control SET mode = 'normal' WHERE id = true AND mode = 'lose-response'",
  );
  return rowCount === 1;
}

export async function inspect(pool: Pool, paymentId: string) {
  const { rows } = await pool.query(
    `SELECT p.id, b.status, b.receipt, count(e.id)::int AS "paidEvents"
     FROM (VALUES ($1::uuid)) AS p(id)
     LEFT JOIN bank_payments b ON b.payment_id = p.id
     LEFT JOIN bank_events e ON e.payment_id = p.id AND e.event_type = 'PAID'
     GROUP BY p.id, b.status, b.receipt`,
    [paymentId],
  );
  return rows[0];
}
