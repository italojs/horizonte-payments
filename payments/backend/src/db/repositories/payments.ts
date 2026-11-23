import type { Pool } from 'pg';

const columns = `id, state, amount_minor AS "amountMinor", currency, beneficiary_ref AS "beneficiaryRef",
  bill_ref AS "billRef", created_at AS "createdAt", provider_ref AS receipt`;

interface Row {
  id: string;
  state: string;
  amountMinor: string;
  billRef: string;
  currency: string;
  beneficiaryRef: string;
  createdAt: Date;
  receipt: string | null;
}
function present(row: Row) {
  return { ...row, amountMinor: Number(row.amountMinor) };
}

export function paymentRepository(db: Pool) {
  return {
    async list(company: string) {
      const { rows } = await db.query<Row>(
        `SELECT ${columns} FROM payments
        WHERE company_id=$1 ORDER BY created_at DESC, id LIMIT 100`,
        [company],
      );
      return rows.map(present);
    },
    async find(company: string, id: string) {
      const { rows } = await db.query<Row>(
        `SELECT ${columns} FROM payments WHERE company_id=$1 AND id=$2`,
        [company, id],
      );
      return rows[0] ? present(rows[0]) : undefined;
    },
    async detail(company: string, id: string) {
      const { rows } = await db.query<
        Row & { events: { eventType: string; actor: string; createdAt: string }[] }
      >(
        `
        SELECT ${columns}, COALESCE((SELECT json_agg(json_build_object(
          'eventType', e.event_type, 'actor', e.actor, 'createdAt', e.created_at) ORDER BY e.id)
          FROM payment_events e WHERE e.company_id=p.company_id AND e.payment_id=p.id), '[]') AS events
        FROM payments p WHERE company_id=$1 AND id=$2`,
        [company, id],
      );
      return rows[0] ? { ...present(rows[0]), events: rows[0].events } : undefined;
    },
  };
}
export type PaymentRepository = ReturnType<typeof paymentRepository>;
