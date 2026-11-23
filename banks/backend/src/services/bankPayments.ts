import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction } from '../db/connection.ts';
import {
  lockPayment,
  currentMode,
  findPayment,
  recordTransition,
  consumeLostResponse,
} from '../db/repositories/bankPayments.ts';
import { withSpan } from '../observability/telemetry.ts';
import type { Operation } from '../types/operation.ts';
import { decideBank, type BankAction } from './settlement.ts';

export function perform(pool: Pool, action: BankAction, operation: Operation) {
  const { paymentId, companyId, amountMinor, beneficiaryRef, currency } = operation;
  return withSpan(
    'bank.' + action,
    () =>
      transaction(pool, async (client) => {
        await lockPayment(client, paymentId);
        const mode = await currentMode(client);
        if (mode === 'offline') return { code: 503, status: 'UNAVAILABLE' };

        const previous = await findPayment(client, paymentId);
        if (previous && previous.company_id !== companyId) return { code: 404, status: 'UNKNOWN' };
        if (action === 'submit' && (!amountMinor || !beneficiaryRef || !currency))
          return { code: 400, status: 'INVALID' };
        if (
          action === 'submit' &&
          previous?.amount_minor != null &&
          (Number(previous.amount_minor) !== amountMinor ||
            previous.currency !== currency ||
            previous.beneficiary_ref !== beneficiaryRef)
        ) {
          return { code: 409, status: 'CONFLICT' };
        }

        const status = decideBank(action, previous?.status ?? null, mode);
        if (!status) return { code: 404, status: 'UNKNOWN' };
        let receipt = previous?.receipt ?? null;
        if (status !== previous?.status) {
          if (status === 'PAID') receipt = 'B-' + randomUUID();
          await recordTransition(client, operation, status, receipt);
        }
        const lost =
          action === 'submit' &&
          status === 'PAID' &&
          mode === 'lose-response' &&
          (await consumeLostResponse(client));
        return { code: status === 'REJECTED' ? 422 : 200, status, receipt, lost };
      }),
    { 'payment.id': paymentId },
  );
}
