import { createHash } from 'node:crypto';
import { queues, type Command } from '@horizonte/payments-runtime/broker';
import { withSpan } from '@horizonte/payments-runtime/telemetry';
import { bills } from '../domain/bills.ts';
import type { PaymentRepository } from '../db/repositories/payments.ts';

export class PaymentError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
function paymentId(tenant: string, key: string) {
  const bytes = createHash('sha256')
    .update(JSON.stringify([tenant, key]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

interface Dependencies {
  repository: PaymentRepository;
  publish: (queue: string, command: Command) => Promise<void>;
  balance: (company: string) => Promise<{ availableMinor: number; currency: string }>;
}
export function paymentService(
  { repository, publish, balance }: Dependencies,
  companyId = 'horizonte',
) {
  async function find(id: string) {
    const payment = await repository.find(companyId, id);
    if (!payment) throw new PaymentError(404, 'Payment not found');
    return payment;
  }
  return {
    bills: () => bills,
    async account() {
      try {
        return await balance(companyId);
      } catch {
        throw new PaymentError(503, 'Account balance is unavailable');
      }
    },
    async list() {
      return { items: await repository.list(companyId) };
    },
    async detail(id: string) {
      const payment = await repository.detail(companyId, id);
      if (!payment) throw new PaymentError(404, 'Payment not found');
      return payment;
    },
    async create(billRef: string, key: unknown) {
      if (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(key))
        throw new PaymentError(400, 'A valid Idempotency-Key is required');
      const bill = bills.find((candidate) => candidate.billRef === billRef);
      if (!bill) throw new PaymentError(422, 'Unknown bill');
      const id = paymentId(companyId, key);
      const existing = await repository.find(companyId, id);
      if (
        existing &&
        (existing.billRef !== bill.billRef ||
          existing.amountMinor !== bill.amountMinor ||
          existing.currency !== bill.currency ||
          existing.beneficiaryRef !== bill.beneficiaryRef)
      )
        throw new PaymentError(409, 'The idempotency key already identifies another payment');
      try {
        await withSpan(
          'payment.accept',
          () =>
            publish(queues.create, {
              id: id + '/create',
              kind: 'create',
              paymentId: id,
              companyId,
              actor: 'payments-api',
              accountId: 'acc-' + companyId,
              billRef,
              amountMinor: bill.amountMinor,
              beneficiaryRef: bill.beneficiaryRef,
              currency: bill.currency,
              idempotencyKey: key,
            }),
          { 'payment.id': id },
        );
      } catch {
        throw new PaymentError(
          503,
          'Delivery is unconfirmed. Retry with the same idempotency key.',
        );
      }
      return { id };
    },
    async cancel(id: string) {
      const payment = await find(id);
      if (['PAID', 'FAILED'].includes(payment.state))
        throw new PaymentError(409, 'Payment is already final');
      try {
        await withSpan(
          'payment.cancel',
          () =>
            publish(queues.cancel, {
              kind: 'cancel',
              id: id + '/cancel',
              paymentId: id,
              companyId,
              actor: 'payments-api',
              reason: 'user',
            }),
          { 'payment.id': id },
        );
      } catch {
        throw new PaymentError(503, 'Cancellation is unconfirmed. Retry the request.');
      }
      return { id };
    },
  };
}
export type PaymentService = ReturnType<typeof paymentService>;
