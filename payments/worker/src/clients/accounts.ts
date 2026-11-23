import { env } from '@horizonte/payments-runtime/config';
import { withSpan } from '@horizonte/payments-runtime/telemetry';
import { positiveEnv } from '../config.ts';
import { Uncertain, type Payment, type Reply } from '../domain/payment.ts';
import { request, readReply } from './http.ts';

export async function accounts(
  operation: 'reserve' | 'capture' | 'release',
  payment: Payment,
): Promise<Reply> {
  const base = env('ACCOUNTS_URL');
  const timeout = positiveEnv('ACCOUNTS_TIMEOUT_MS', 2500);
  return withSpan(
    'accounts.' + operation,
    async () => {
      try {
        const response = await request(base, '/' + operation, timeout, {
          paymentId: payment.id,
          companyId: payment.company_id,
          accountId: payment.account_id,
          currency: payment.currency,
          amountMinor: Number(payment.amount_minor),
        });
        if (response.status === 422 && operation === 'reserve') {
          const result = (await response.json()) as { status: string };
          if (result.status === 'INSUFFICIENT_FUNDS') return { status: 'INSUFFICIENT' };
        }
        if (!response.ok) throw new Error('Accounts request failed');
        return await readReply(response, ['HELD', 'CAPTURED', 'RELEASED']);
      } catch {
        throw new Uncertain('accounts ' + operation + ' outcome unknown');
      }
    },
    { 'payment.id': payment.id, 'payment.company': payment.company_id },
  );
}
