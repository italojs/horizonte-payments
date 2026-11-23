import type { Pool, PoolClient } from 'pg';
import { queues, type Command } from '@horizonte/payments-runtime/broker';
import { withSpan } from '@horizonte/payments-runtime/telemetry';
import type { Payment } from '../../domain/payment.ts';
import type { Services } from '../../clients/providers.ts';
import {
  terminal,
  uuid,
  sameInput,
  samePayment,
  successor,
  type Next,
} from '../../domain/commands.ts';
import { advance, type Decision, type AfterProvider } from '../../services/advancePayment.ts';

async function audit(
  db: PoolClient,
  c: Command,
  event: string,
  p: Pick<Payment, 'state' | 'version'>,
  detail?: string,
) {
  await db.query(
    'INSERT INTO payment_events(company_id,payment_id,event_type,actor,state,version,detail) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [c.companyId, c.paymentId, event, c.actor, p.state, p.version, detail ?? null],
  );
}
async function update(
  db: PoolClient,
  c: Command,
  p: Payment,
  d: Decision,
  reason?: string,
): Promise<Next | null> {
  const {
    rows: [modified],
  } = await db.query<Payment>(
    `UPDATE payments SET state=$1,attempt=$2,review_required=$3,
    provider_ref=COALESCE($4,provider_ref),cancel_reason=COALESCE($5,cancel_reason),submission_intent=submission_intent OR $9,
    version=version+1,updated_at=clock_timestamp()
    WHERE id=$6 AND company_id=$7 AND version=$8 RETURNING *`,
    [
      d.state,
      d.attempt ?? 0,
      d.review ?? false,
      d.receipt ?? null,
      reason ?? null,
      c.paymentId,
      c.companyId,
      p.version,
      d.authorizeSubmit ?? false,
    ],
  );
  if (!modified) throw new Error('Concurrent payment update');
  await audit(db, c, d.event, modified, d.detail);
  if (d.autoCancel)
    return {
      queue: queues.cancel,
      command: {
        id: c.paymentId + '/auto-cancel/v' + modified.version,
        kind: 'cancel',
        paymentId: c.paymentId,
        companyId: c.companyId,
        actor: 'payments-worker',
        version: modified.version,
        reason: 'provider retries exhausted',
      },
    };
  if (terminal.has(modified.state)) return null;
  return successor(
    c,
    modified.version,
    d.review ? queues.dlq : d.delay !== undefined ? queues.retry : queues.process,
    d.delay,
  );
}
async function find(db: PoolClient, c: Command) {
  const result = await db.query<Payment>(
    'SELECT * FROM payments WHERE company_id=$1 AND id=$2 FOR UPDATE',
    [c.companyId, c.paymentId],
  );
  return result.rows[0];
}
async function create(db: PoolClient, c: Command): Promise<Next | null> {
  const inserted = await db.query<Payment>(
    `INSERT INTO payments (id,company_id,account_id,beneficiary_ref,bill_ref,amount_minor,currency,state,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'RESERVATION_PENDING',$8) ON CONFLICT DO NOTHING RETURNING *`,
    [
      c.paymentId,
      c.companyId,
      c.accountId,
      c.beneficiaryRef,
      c.billRef,
      c.amountMinor,
      c.currency,
      c.idempotencyKey,
    ],
  );
  const p = inserted.rows[0];
  if (!p) {
    const existing = await find(db, c);
    if (existing)
      await audit(
        db,
        c,
        samePayment(c, existing) ? 'DUPLICATE_CREATE' : 'IDEMPOTENCY_CONFLICT',
        existing,
      );
    return null;
  }
  await audit(db, c, 'PAYMENT_CREATED', p);
  const early = await db.query(
    'DELETE FROM early_cancellations WHERE company_id=$1 AND payment_id=$2 RETURNING *',
    [c.companyId, c.paymentId],
  );
  if (early.rows[0])
    return update(
      db,
      { ...c, actor: early.rows[0].actor },
      p,
      {
        state: 'CANCELLATION_PENDING',
        event: 'CANCELLATION_REQUESTED',
        detail: 'requested before creation',
      },
      early.rows[0].reason,
    );
  return successor(c, p.version);
}

async function decide(
  db: PoolClient,
  c: Command,
  services: Services,
  afterProvider: AfterProvider,
): Promise<Next | null> {
  if (c.kind === 'create') return create(db, c);
  const p = await find(db, c);
  if (c.kind === 'cancel') {
    const reason = c.reason || 'requested by operator';
    if (!p) {
      await db.query(
        `INSERT INTO early_cancellations(company_id,payment_id,actor,reason)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [c.companyId, c.paymentId, c.actor, reason],
      );
      return null;
    }
    if (c.version !== undefined && c.version !== p.version) return null;
    if (['RESERVATION_PENDING', 'AWAITING_SUBMISSION', 'AWAITING_CONFIRMATION'].includes(p.state)) {
      return update(
        db,
        c,
        p,
        { state: 'CANCELLATION_PENDING', event: 'CANCELLATION_REQUESTED' },
        reason,
      );
    }
    await audit(db, c, 'CANCELLATION_OBSERVED', p, 'already in ' + p.state);
    return null;
  }
  if (!p || p.version !== c.version || terminal.has(p.state)) return null;
  if (p.review_required) await audit(db, c, 'OPERATOR_REDRIVE', p);
  if (p.state === 'AWAITING_CONFIRMATION' || p.state === 'CANCELLATION_PENDING')
    await audit(db, c, 'RECONCILIATION_STARTED', p);
  const decision = await withSpan('saga.' + p.state, () => advance(p, services, afterProvider), {
    'payment.id': p.id,
    'payment.state': p.state,
    'payment.version': p.version,
  });
  return update(db, c, p, decision);
}

export async function applyCommand(
  pool: Pool,
  c: Command,
  services: Services,
  afterProvider: AfterProvider,
): Promise<Next | null> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serializes create vs early cancel and multiple consumers even before the payment row exists.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      c.companyId + '/' + c.paymentId,
    ]);
    const receipt = await db.query<{ input: Command; successor: Next | null }>(
      'SELECT input,successor FROM command_receipts WHERE company_id=$1 AND command_id=$2',
      [c.companyId, c.id],
    );
    let next: Next | null;
    if (receipt.rows[0]) {
      const saved = receipt.rows[0];
      if (sameInput(saved.input, c)) next = saved.successor;
      else {
        const p = await find(db, c);
        if (p)
          await audit(
            db,
            c,
            'IDEMPOTENCY_CONFLICT',
            p,
            'command identifier reused with different input',
          );
        next = null;
      }
    } else {
      next = await decide(db, c, services, afterProvider);
      await db.query(
        'INSERT INTO command_receipts(company_id,command_id,payment_id,input,successor) VALUES ($1,$2,$3,$4,$5)',
        [c.companyId, c.id, c.paymentId, c, next],
      );
    }
    await db.query('COMMIT');
    return next;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

// Retrieve a parked payment's exact successor. Other DLQ messages stay in place.
export async function reviewCommand(
  pool: Pool,
  paymentId: string,
  companyId?: string,
): Promise<Command | null> {
  if (!uuid.test(paymentId)) throw new Error('Invalid payment UUID');
  const { rows } = await pool.query<{ command: Command }>(
    `SELECT r.successor->'command' AS command
    FROM payments p JOIN command_receipts r ON r.payment_id=p.id AND r.company_id=p.company_id
    WHERE p.id=$1 AND ($2::text IS NULL OR p.company_id=$2) AND p.review_required
      AND r.successor->>'queue'=$3 AND r.successor->'command'->>'version'=p.version::text
    ORDER BY r.decided_at DESC LIMIT 1`,
    [paymentId, companyId ?? null, queues.dlq],
  );
  return rows[0]?.command ?? null;
}
