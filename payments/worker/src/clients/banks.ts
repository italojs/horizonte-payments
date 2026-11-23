import type { Pool } from 'pg';
import { env } from '@horizonte/payments-runtime/config';
import { withSpan } from '@horizonte/payments-runtime/telemetry';
import { positiveEnv } from '../config.ts';
import { acquire, record } from '../db/repositories/bankCircuit.ts';
import { Uncertain, type Payment, type Reply } from '../domain/payment.ts';
import { request, readReply } from './http.ts';

export function bankClient(pool: Pool) {
  return async (operation: 'submit' | 'status' | 'cancel', payment: Payment): Promise<Reply> => {
    const base = env('BANK_URL');
    const timeout = positiveEnv('BANK_TIMEOUT_MS', 2500);
    const lookup = operation === 'status';
    return withSpan(
      'bank.' + operation,
      async () => {
        const permit = await acquire(pool, timeout);
        let reply: Reply;
        try {
          const response = lookup
            ? await request(
                base,
                '/payments/' + payment.id + '?companyId=' + encodeURIComponent(payment.company_id),
                timeout,
              )
            : await request(base, '/' + operation, timeout, {
                paymentId: payment.id,
                companyId: payment.company_id,
                beneficiaryRef: payment.beneficiary_ref,
                amountMinor: Number(payment.amount_minor),
                currency: payment.currency,
              });
          if (response.status === 404 && lookup) reply = { status: 'ABSENT' };
          else if (response.status === 422) reply = await readReply(response, ['REJECTED']);
          else {
            if (!response.ok) throw new Error('Bank request failed');
            reply = await readReply(response, ['PAID', 'CANCELLED', 'REJECTED', 'PROCESSING']);
          }
        } catch {
          await record(pool, permit, false);
          throw new Uncertain('bank ' + operation + ' outcome unknown');
        }
        await record(pool, permit, true);
        return reply;
      },
      { 'payment.id': payment.id, 'payment.company': payment.company_id },
    );
  };
}
