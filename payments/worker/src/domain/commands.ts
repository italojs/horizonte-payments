import { queues, type Command } from '@horizonte/payments-runtime/broker';
import type { Payment, State } from './payment.ts';

export const terminal = new Set<State>(['PAID', 'FAILED', 'CANCELLED']);
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}
export function validCommand(input: unknown): input is Command {
  if (!input || typeof input !== 'object') return false;
  const c = input as Command;
  if (!nonempty(c.id) || !uuid.test(c.paymentId) || !nonempty(c.companyId) || !nonempty(c.actor))
    return false;
  if (c.kind === 'cancel') return c.reason === undefined || nonempty(c.reason);
  if (c.kind === 'process') return Number.isSafeInteger(c.version) && Number(c.version) > 0;
  return (
    c.kind === 'create' &&
    [c.accountId, c.billRef, c.beneficiaryRef, c.currency, c.idempotencyKey].every(nonempty) &&
    Number.isSafeInteger(c.amountMinor) &&
    Number(c.amountMinor) > 0
  );
}
export function samePayment(c: Command, p: Payment) {
  return (
    c.companyId === p.company_id &&
    c.accountId === p.account_id &&
    c.billRef === p.bill_ref &&
    c.beneficiaryRef === p.beneficiary_ref &&
    c.currency === p.currency &&
    String(c.amountMinor) === p.amount_minor &&
    c.idempotencyKey === p.idempotency_key
  );
}
export function sameInput(a: Command, b: Command) {
  const fields: (keyof Command)[] = [
    'kind',
    'paymentId',
    'companyId',
    'accountId',
    'billRef',
    'beneficiaryRef',
    'amountMinor',
    'currency',
    'idempotencyKey',
    'version',
    'reason',
  ];
  // Replaying the same financial intent preserves its original financial fields.
  return fields.every((field) => a[field] === b[field]);
}
export interface Next {
  queue: string;
  command: Command;
  availableAt?: number;
}

export function successor(
  c: Command,
  version: number,
  queue: string = queues.process,
  delay?: number,
): Next {
  const command: Command = {
    id: c.paymentId + '/v' + version,
    kind: 'process',
    paymentId: c.paymentId,
    companyId: c.companyId,
    actor: 'payments-worker',
    version,
  };
  return { command, queue, ...(delay !== undefined ? { availableAt: Date.now() + delay } : {}) };
}
