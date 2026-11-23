import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server/index.ts';
import { paymentService } from '../src/services/payments.ts';
import type { PaymentRepository } from '../src/db/repositories/payments.ts';

const row = {
  id: '942cd381-edf7-4bed-a433-221da09079c8',
  billRef: 'ipe-192',
  beneficiaryRef: 'ipe',
  amountMinor: 85000,
  currency: 'BRL',
  state: 'AWAITING_CONFIRMATION',
  createdAt: new Date(),
  receipt: null,
};
const repository = {
  find: vi.fn<PaymentRepository['find']>(),
  list: vi.fn<PaymentRepository['list']>(),
  detail: vi.fn<PaymentRepository['detail']>(),
};
const publish = vi.fn(async (_queue: string, _command: unknown) => {});
const balance = vi.fn(async (_company: string) => ({ availableMinor: 1_200_000, currency: 'BRL' }));
let server: ReturnType<typeof buildServer>;
beforeEach(() => {
  vi.clearAllMocks();
  repository.find.mockResolvedValue(undefined);
  server = buildServer(paymentService({ repository, publish, balance }));
});
afterEach(async () => {
  await server.close();
});

const create = (billRef = 'ipe-192', key = 'client-retry') =>
  server.inject({
    method: 'POST',
    url: '/api/payments',
    headers: { 'idempotency-key': key },
    payload: { billRef },
  });

describe('Payments public API', () => {
  it('offers the configured English bill catalogue and a balance from Accounts', async () => {
    const bills = await server.inject('/api/bills');
    expect(bills.json()).toEqual([
      {
        billRef: 'atlas-483',
        beneficiaryRef: 'atlas',
        name: 'Atlas Supplies',
        amountMinor: 300000,
        currency: 'BRL',
      },
      {
        billRef: 'ipe-192',
        beneficiaryRef: 'ipe',
        name: 'Ipe Workshop',
        amountMinor: 85000,
        currency: 'BRL',
      },
    ]);
    expect((await server.inject('/api/account')).json()).toEqual({
      availableMinor: 1200000,
      currency: 'BRL',
    });
    expect(balance).toHaveBeenCalledWith('horizonte');
    balance.mockRejectedValueOnce(new Error('Accounts is down'));
    expect((await server.inject('/api/account')).statusCode).toBe(503);
  });
  it('confirms a durable command and returns the same location for a replay', async () => {
    const first = await create();
    const duplicate = await create();
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual(duplicate.json());
    expect(first.headers.location).toEqual('/api/payments/' + first.json().id);
    expect(publish).toHaveBeenCalledWith(
      'payments.create',
      expect.objectContaining({
        kind: 'create',
        billRef: 'ipe-192',
        paymentId: first.json().id,
        idempotencyKey: 'client-retry',
        amountMinor: 85000,
      }),
    );
    publish.mockRejectedValueOnce(new Error('missing confirmation'));
    expect((await create()).statusCode).toBe(503);
    expect((await create()).json()).toEqual(first.json());
  });
  it('rejects bad input and conflicting stored financial intent before publishing', async () => {
    expect((await create('missing')).statusCode).toBe(422);
    expect((await create('ipe-192', 'bad key')).statusCode).toBe(400);
    repository.find.mockResolvedValue(row);
    expect((await create('atlas-483')).statusCode).toBe(409);
    expect(publish).not.toHaveBeenCalled();
  });
  it('serves the list and audit events and accepts a cancellation for a pending payment', async () => {
    repository.list.mockResolvedValue([row]);
    repository.find.mockResolvedValue(row);
    repository.detail.mockResolvedValue({
      ...row,
      events: [
        {
          eventType: 'FUNDS_RESERVED',
          actor: 'payments-worker',
          createdAt: row.createdAt.toISOString(),
        },
      ],
    });
    expect((await server.inject('/api/payments')).json().items[0].id).toEqual(row.id);
    expect((await server.inject('/api/payments/' + row.id)).json().events[0].eventType).toBe(
      'FUNDS_RESERVED',
    );
    const cancel = () =>
      server.inject({ method: 'POST', url: '/api/payments/' + row.id + '/cancel' });
    expect((await cancel()).statusCode).toBe(202);
    expect(publish).toHaveBeenCalledWith(
      'payments.cancel',
      expect.objectContaining({ kind: 'cancel', paymentId: row.id }),
    );
    repository.find.mockResolvedValue({ ...row, state: 'PAID' });
    expect((await cancel()).statusCode).toBe(409);
    repository.find.mockResolvedValue(undefined);
    expect((await cancel()).statusCode).toBe(404);
  });
});
