import { describe, expect, it, vi } from 'vitest';
import type { Command } from '@horizonte/payments-runtime/broker';
import { advance } from '../../src/services/advancePayment.ts';
import { samePayment, validCommand } from '../../src/domain/commands.ts';
import { CircuitOpen, Uncertain, type Payment, type Reply } from '../../src/domain/payment.ts';
import type { Services } from '../../src/clients/providers.ts';

const p: Payment = {
  id: '91eb20b2-7e4d-4725-a44e-bdf800000001',
  company_id: 'horizonte',
  account_id: 'acc-horizonte',
  bill_ref: 'BILL-A',
  beneficiary_ref: 'ACME',
  amount_minor: '500',
  currency: 'BRL',
  idempotency_key: 'req-1',
  state: 'AWAITING_CONFIRMATION',
  submission_intent: true,
  attempt: 0,
  version: 3,
  provider_ref: null,
  cancel_reason: null,
  review_required: false,
};
const c: Command = {
  id: 'req-1',
  kind: 'create',
  paymentId: p.id,
  companyId: 'horizonte',
  actor: 'operator',
  accountId: p.account_id,
  billRef: p.bill_ref,
  beneficiaryRef: p.beneficiary_ref,
  amountMinor: 500,
  currency: 'BRL',
  idempotencyKey: 'req-1',
};
function stubs() {
  const bank = vi.fn<Services['bank']>();
  const accounts = vi.fn<Services['accounts']>();
  const after = vi.fn(async (_id: string) => {});
  return { bank, accounts, after };
}

describe('financial decisions', () => {
  it('requires the same financial fields for idempotent reuse', () => {
    expect(validCommand(c)).toBe(true);
    expect(validCommand({ ...c, amountMinor: 0 })).toBe(false);
    expect(samePayment(c, p)).toBe(true);
    for (const field of [
      'accountId',
      'billRef',
      'beneficiaryRef',
      'amountMinor',
      'companyId',
      'currency',
      'idempotencyKey',
    ])
      expect(samePayment({ ...c, [field]: 'other' }, p)).toBe(false);
  });

  it('returns a receipt from the bank and captures only after PAID', async () => {
    const s = stubs();
    s.bank
      .mockResolvedValueOnce({ status: 'ABSENT' })
      .mockResolvedValueOnce({ status: 'PAID', receipt: 'B-1' });
    const d = await advance(p, s, s.after);
    expect(d).toMatchObject({ state: 'DEBIT_PENDING', receipt: 'B-1' });
    expect(s.bank.mock.calls.map(([op]) => op)).toEqual(['status', 'submit']);
    expect(s.after).toHaveBeenCalledOnce();
    expect(s.accounts).not.toHaveBeenCalled();
    s.accounts.mockResolvedValue({ status: 'CAPTURED' });
    expect(await advance({ ...p, state: d.state }, s, s.after)).toMatchObject({ state: 'PAID' });
  });

  it('recovers a committed bank payment after its HTTP response was lost', async () => {
    const s = stubs();
    s.bank
      .mockResolvedValueOnce({ status: 'ABSENT' })
      .mockRejectedValueOnce(new Uncertain('timeout'));
    const first = await advance(p, s, s.after);
    expect(first).toMatchObject({
      state: 'AWAITING_CONFIRMATION',
      event: 'RETRY_SCHEDULED',
      attempt: 1,
    });
    expect(first.delay).toBeGreaterThan(0);
    expect(s.accounts).not.toHaveBeenCalled();
    s.bank.mockResolvedValueOnce({ status: 'PAID', receipt: 'B-lost' });
    const second = await advance({ ...p, state: first.state, attempt: 1 }, s, s.after);
    expect(second).toMatchObject({ state: 'DEBIT_PENDING', receipt: 'B-lost' });
    expect(s.bank.mock.calls.map(([op]) => op)).toEqual(['status', 'submit', 'status']);
  });

  it('keeps reconciling a previously submitted cancellation during a sustained outage', async () => {
    const s = stubs();
    s.bank.mockRejectedValue(new Uncertain('offline'));
    expect(
      await advance({ ...p, state: 'CANCELLATION_PENDING', attempt: 3 }, s, s.after),
    ).toMatchObject({
      state: 'CANCELLATION_PENDING',
      event: 'RECONCILIATION_DEFERRED',
      attempt: 3,
    });
    expect(s.accounts).not.toHaveBeenCalled();
  });

  it('authorizes submission durably before a sender can make the first POST', async () => {
    const s = stubs();
    s.bank.mockResolvedValueOnce({ status: 'ABSENT' });
    expect(
      await advance({ ...p, state: 'AWAITING_SUBMISSION', submission_intent: false }, s, s.after),
    ).toMatchObject({
      state: 'AWAITING_CONFIRMATION',
      authorizeSubmit: true,
      event: 'PROVIDER_SUBMISSION_AUTHORIZED',
    });
    expect(s.bank.mock.calls.map(([op]) => op)).toEqual(['status']);
  });

  it('can release an offline pre-submit cancellation using the durable absence of submission intent', async () => {
    const s = stubs();
    expect(
      await advance({ ...p, state: 'CANCELLATION_PENDING', submission_intent: false }, s, s.after),
    ).toMatchObject({
      state: 'CANCEL_RELEASE_PENDING',
      event: 'CANCELLED_BEFORE_SUBMISSION',
    });
    expect(s.bank).not.toHaveBeenCalled();
  });

  it('waits for the shared breaker without spending a provider attempt', async () => {
    const s = stubs();
    s.bank.mockRejectedValue(new CircuitOpen(Date.now() + 4000));
    const d = await advance({ ...p, state: 'CANCELLATION_PENDING', attempt: 2 }, s, s.after);
    expect(d).toMatchObject({
      state: 'CANCELLATION_PENDING',
      event: 'BANK_CIRCUIT_OPEN',
      attempt: 2,
    });
    expect(d.delay).toBeGreaterThan(0);
  });

  it.each(['PROCESSING', 'ABSENT'] as const)(
    'fences a %s provider payment before allowing release',
    async (status) => {
      const s = stubs();
      s.bank.mockResolvedValueOnce({ status }).mockResolvedValueOnce({ status: 'CANCELLED' });
      expect(await advance({ ...p, state: 'CANCELLATION_PENDING' }, s, s.after)).toMatchObject({
        state: 'CANCEL_RELEASE_PENDING',
      });
      expect(s.bank.mock.calls.map(([op]) => op)).toEqual(['status', 'cancel']);
      expect(s.accounts).not.toHaveBeenCalled();
    },
  );

  it('records a paid receipt when a cancellation races a provider confirmation', async () => {
    const s = stubs();
    s.bank
      .mockResolvedValueOnce({ status: 'PROCESSING' })
      .mockResolvedValueOnce({ status: 'PAID', receipt: 'B-race' });
    expect(await advance({ ...p, state: 'CANCELLATION_PENDING' }, s, s.after)).toMatchObject({
      state: 'DEBIT_PENDING',
      receipt: 'B-race',
    });
    expect(s.accounts).not.toHaveBeenCalled();
  });

  it.each([
    ['PROCESSING', 'AWAITING_CONFIRMATION'],
    ['REJECTED', 'FAILURE_RELEASE_PENDING'],
  ] as const)('handles %s', async (status, state) => {
    const s = stubs();
    s.bank.mockResolvedValue({ status } as Reply);
    expect(await advance(p, s, s.after)).toMatchObject({ state });
    expect(s.accounts).not.toHaveBeenCalled();
  });
});
