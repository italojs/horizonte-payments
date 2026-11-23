import type { Pool, PoolClient } from 'pg';
import type { AccountAction, HoldState } from '../../services/reservation.ts';

interface AccountRow {
  id: string;
  currency: string;
  balance_minor: string;
  reserved_minor: string;
}
interface ReservationRow {
  account_id: string;
  amount_minor: string;
  status: HoldState;
}

export async function findAvailable(pool: Pool, companyId: string) {
  const { rows } = await pool.query<{ id: string; currency: string; available: string }>(
    'SELECT id, currency, balance_minor - reserved_minor AS available FROM accounts WHERE company_id = $1',
    [companyId],
  );
  const account = rows[0];
  return (
    account && {
      id: account.id,
      availableMinor: Number(account.available),
      currency: account.currency,
    }
  );
}

export async function lockAccount(client: PoolClient, companyId: string, paymentId: string) {
  // One payment can be presented against different accounts before either reservation exists.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
    paymentId,
  ]);
  const { rows } = await client.query<AccountRow>(
    'SELECT id, currency, balance_minor, reserved_minor FROM accounts WHERE company_id = $1 FOR UPDATE',
    [companyId],
  );
  return rows[0];
}

export async function findReservation(client: PoolClient, paymentId: string) {
  const { rows } = await client.query<ReservationRow>(
    'SELECT account_id, amount_minor, status FROM reservations WHERE payment_id = $1',
    [paymentId],
  );
  return rows[0];
}

export async function recordTransition(
  client: PoolClient,
  paymentId: string,
  accountId: string,
  amount: number,
  action: AccountAction,
  decision: { status: HoldState; balanceDelta: number; reservedDelta: number },
) {
  await client.query(
    `INSERT INTO reservations(payment_id, account_id, amount_minor, status) VALUES ($1, $2, $3, $4)
     ON CONFLICT (payment_id) DO UPDATE SET status = excluded.status`,
    [paymentId, accountId, amount, decision.status],
  );
  await client.query(
    'UPDATE accounts SET balance_minor = balance_minor + $2, reserved_minor = reserved_minor + $3 WHERE id = $1',
    [accountId, decision.balanceDelta, decision.reservedDelta],
  );
  await client.query(
    'INSERT INTO account_entries(account_id, payment_id, kind, balance_delta, reserved_delta) VALUES ($1,$2,$3,$4,$5)',
    [accountId, paymentId, action, decision.balanceDelta, decision.reservedDelta],
  );
}

export async function inspect(pool: Pool, paymentId: string) {
  const { rows } = await pool.query(
    `SELECT r.status, r.account_id AS account, r.amount_minor AS "amountMinor",
       count(e.id) FILTER (WHERE e.kind = 'reserve')::int AS reserves,
       count(e.id) FILTER (WHERE e.kind = 'capture')::int AS captures,
       count(e.id) FILTER (WHERE e.kind = 'release')::int AS releases
     FROM (VALUES ($1::uuid)) AS p(id)
     LEFT JOIN reservations r ON r.payment_id = p.id
     LEFT JOIN account_entries e ON e.payment_id = p.id
     GROUP BY r.status, r.account_id, r.amount_minor`,
    [paymentId],
  );
  const row = rows[0];
  return { ...row, amountMinor: row.amountMinor === null ? null : Number(row.amountMinor) };
}
