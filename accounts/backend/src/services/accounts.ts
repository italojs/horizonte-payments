import type { Pool } from 'pg';
import { transaction } from '../db/connection.ts';
import { lockAccount, findReservation, recordTransition } from '../db/repositories/accounts.ts';
import { withSpan } from '../observability/telemetry.ts';
import type { Operation } from '../types/operation.ts';
import { decideReservation, type AccountAction } from './reservation.ts';

export function applyReservation(pool: Pool, action: AccountAction, operation: Operation) {
  const { paymentId, companyId, accountId, amountMinor, currency } = operation;
  return withSpan(
    'accounts.' + action,
    () =>
      transaction(pool, async (client) => {
        const account = await lockAccount(client, companyId, paymentId);
        if (!account || (accountId && accountId !== account.id))
          return { code: 404, status: 'UNKNOWN_ACCOUNT' };
        const hold = await findReservation(client, paymentId);
        if (hold && hold.account_id !== account.id) return { code: 404, status: 'UNKNOWN_ACCOUNT' };
        if (action === 'reserve' && (!amountMinor || currency !== account.currency || !accountId)) {
          return { code: 400, status: 'INVALID' };
        }
        if (
          hold &&
          hold.status !== 'RELEASED' &&
          amountMinor &&
          Number(hold.amount_minor) !== amountMinor
        ) {
          return { code: 409, status: 'CONFLICT' };
        }

        const amount = Number(hold?.amount_minor ?? amountMinor ?? 0);
        const available = Number(account.balance_minor) - Number(account.reserved_minor);
        const decision = decideReservation(action, hold?.status ?? null, amount, available);
        if (decision.code !== 200 || !decision.status) {
          return {
            code: decision.code,
            status: decision.code === 422 ? 'INSUFFICIENT_FUNDS' : 'CONFLICT',
          };
        }
        if (hold?.status !== decision.status) {
          await recordTransition(client, paymentId, account.id, amount, action, {
            ...decision,
            status: decision.status,
          });
        }
        return { code: 200, status: decision.status };
      }),
    { 'payment.id': paymentId },
  );
}
