import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyCommand, reviewCommand } from '../../src/db/repositories/paymentCommands.ts';
import type { Command } from '@horizonte/payments-runtime/broker';
import { CircuitOpen, Uncertain } from '../../src/domain/payment.ts';
import { makeServices, type Services } from '../../src/clients/providers.ts';

const url = process.env.PAYMENTS_TEST_DB;
describe.skipIf(!url)('PostgreSQL command recovery', () => {
  const schema = 'saga_test_' + randomUUID().replaceAll('-', '');
  let admin: Pool, pool: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString: url, options: '-c search_path=' + schema });
    await pool.query(
      await readFile(new URL('../../../infra/payments.sql', import.meta.url), 'utf8'),
    );
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    }
  });
  function setup() {
    const id = randomUUID();
    const create: Command = {
      id: 'create/' + id,
      kind: 'create',
      paymentId: id,
      companyId: 'horizonte',
      actor: 'operator',
      accountId: 'acc-horizonte',
      amountMinor: 700,
      beneficiaryRef: 'synthetic',
      billRef: 'BILL-A',
      currency: 'BRL',
      idempotencyKey: id,
    };
    const bank = vi.fn<Services['bank']>(),
      accounts = vi.fn<Services['accounts']>();
    const apply = (c: Command, hook = async (_id: string) => {}) =>
      applyCommand(pool, c, { bank, accounts }, hook);
    const row = async () => (await pool.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0];
    const events = async () =>
      (
        await pool.query('SELECT event_type FROM payment_events WHERE payment_id=$1 ORDER BY id', [
          id,
        ])
      ).rows.map((r) => r.event_type);
    return { create, apply, bank, accounts, row, events };
  }
  it('replays a committed hand-off, serializes two deliveries and ignores stale messages', async () => {
    const t = setup();
    const next = await t.apply(t.create);
    expect(await t.apply(t.create)).toEqual(next);
    t.accounts.mockResolvedValue({ status: 'HELD' });
    const [a, b] = await Promise.all([t.apply(next!.command), t.apply(next!.command)]);
    expect(a).toEqual(b);
    expect(t.accounts).toHaveBeenCalledOnce();
    await t.apply({ ...next!.command, id: 'stale/' + t.create.paymentId });
    expect(t.accounts).toHaveBeenCalledOnce();
    expect((await t.row()).version).toBe(2);
    expect(await t.events()).toEqual(['PAYMENT_CREATED', 'FUNDS_RESERVED']);
  });
  it('recovers a provider effect after the local transaction rolled back', async () => {
    const t = setup();
    t.accounts
      .mockResolvedValueOnce({ status: 'HELD' })
      .mockResolvedValueOnce({ status: 'CAPTURED' });
    const reserve = await t.apply(t.create);
    const authorize = await t.apply(reserve!.command);
    t.bank.mockResolvedValueOnce({ status: 'ABSENT' });
    const submit = await t.apply(authorize!.command);
    expect(await t.row()).toMatchObject({
      state: 'AWAITING_CONFIRMATION',
      submission_intent: true,
    });
    t.bank
      .mockResolvedValueOnce({ status: 'ABSENT' })
      .mockResolvedValueOnce({ status: 'PAID', receipt: 'B-001' });
    await expect(
      t.apply(submit!.command, async () => {
        throw Error('simulated crash');
      }),
    ).rejects.toThrow('simulated crash');
    expect((await t.row()).state).toBe('AWAITING_CONFIRMATION');
    t.bank.mockResolvedValueOnce({ status: 'PAID', receipt: 'B-001' });
    const capture = await t.apply(submit!.command);
    await t.apply(capture!.command);
    expect(await t.row()).toMatchObject({ state: 'PAID', provider_ref: 'B-001' });
    expect(t.bank.mock.calls.map(([op]) => op)).toEqual(['status', 'status', 'submit', 'status']);
  });
  it('persists early cancellation only for the requesting tenant', async () => {
    const t = setup();
    const cancel: Command = {
      id: randomUUID(),
      kind: 'cancel',
      companyId: t.create.companyId,
      paymentId: t.create.paymentId,
      actor: 'canceller',
      reason: 'duplicate invoice',
    };
    await t.apply({ ...cancel, id: randomUUID(), companyId: 'other-company' });
    const reserve = await t.apply(t.create);
    expect((await t.row()).state).toBe('RESERVATION_PENDING');
    await t.apply(cancel);
    expect((await t.row()).state).toBe('CANCELLATION_PENDING');
    expect(await t.apply(reserve!.command)).toBeNull();
    const early = setup();
    await early.apply({ ...cancel, id: randomUUID(), paymentId: early.create.paymentId });
    const next = await early.apply(early.create);
    expect(await early.row()).toMatchObject({
      state: 'CANCELLATION_PENDING',
      cancel_reason: 'duplicate invoice',
    });
    early.bank
      .mockResolvedValueOnce({ status: 'ABSENT' })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    early.accounts.mockResolvedValueOnce({ status: 'RELEASED' });
    const release = await early.apply(next!.command);
    await early.apply(release!.command);
    expect((await early.row()).state).toBe('CANCELLED');
    expect(early.accounts.mock.calls.map(([op]) => op)).toEqual(['release']);
  });
  it.each([false, true])(
    'schedules automatic cancellation with submission intent=%s',
    async (submitted) => {
      const t = setup();
      t.accounts.mockResolvedValueOnce({ status: 'HELD' });
      const reserve = await t.apply(t.create);
      let n = await t.apply(reserve!.command);
      if (submitted) {
        t.bank.mockResolvedValueOnce({ status: 'ABSENT' });
        n = await t.apply(n!.command);
        t.bank
          .mockResolvedValueOnce({ status: 'ABSENT' })
          .mockRejectedValueOnce(new Uncertain('submission response lost'));
      }
      t.bank.mockRejectedValue(new Uncertain('offline'));
      for (let i = 0; i < 3; i++) {
        n = await t.apply(n!.command);
        expect(n!.queue).toBe('payments.retry');
        expect(n!.availableAt).toBeGreaterThan(Date.now() - 100);
      }
      const cancel = await t.apply(n!.command);
      expect(cancel).toMatchObject({ queue: 'payments.cancel', command: { kind: 'cancel' } });
      n = await t.apply(cancel!.command);
      expect((await t.row()).state).toBe('CANCELLATION_PENDING');
      if (submitted) {
        for (let i = 0; i < 5; i++) {
          n = await t.apply(n!.command);
          expect(n!.queue).toBe('payments.retry');
          expect((await t.row()).state).toBe('CANCELLATION_PENDING');
        }
        expect(t.accounts.mock.calls.map(([op]) => op)).toEqual(['reserve']);
        t.bank.mockResolvedValueOnce({ status: 'PAID', receipt: 'B-recovered' });
        t.accounts.mockResolvedValueOnce({ status: 'CAPTURED' });
      } else t.accounts.mockResolvedValueOnce({ status: 'RELEASED' });
      n = await t.apply(n!.command);
      await t.apply(n!.command);
      expect((await t.row()).state).toBe(submitted ? 'PAID' : 'CANCELLED');
    },
  );
  it('shares the bank circuit and reclaims an expired probe without accepting its stale result', async () => {
    const t = setup();
    await t.apply(t.create);
    const payment = await t.row();
    let requests = 0;
    let arrived!: () => void, resume!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const releaseProbe = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const server = createServer(async (_req, res) => {
      const index = ++requests;
      if (index === 2) {
        arrived();
        await releaseProbe;
      }
      res.writeHead(index >= 3 ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'PROCESSING', receipt: null }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      vi.stubEnv('BANK_URL', 'http://127.0.0.1:' + (server.address() as AddressInfo).port);
      vi.stubEnv('BREAKER_THRESHOLD', '1');
      vi.stubEnv('BREAKER_COOLDOWN_MS', '30000');
      const one = makeServices(pool),
        two = makeServices(pool);
      await expect(one.bank('status', payment)).rejects.toBeInstanceOf(Uncertain);
      await expect(two.bank('status', payment)).rejects.toBeInstanceOf(CircuitOpen);
      expect(requests).toBe(1);
      await pool.query("UPDATE bank_breaker SET open_until=now()-interval '1 second'");
      const stale = one.bank('status', payment);
      await probeStarted;
      await expect(two.bank('status', payment)).rejects.toBeInstanceOf(CircuitOpen);
      await pool.query("UPDATE bank_breaker SET probe_until=now()-interval '1 second'");
      expect(await two.bank('status', payment)).toMatchObject({ status: 'PROCESSING' });
      resume();
      await expect(stale).rejects.toBeInstanceOf(Uncertain);
      expect((await pool.query('SELECT * FROM bank_breaker')).rows[0]).toMatchObject({
        failures: 0,
        open_until: null,
        probe: null,
      });
      expect(requests).toBe(3);
    } finally {
      resume();
      vi.unstubAllEnvs();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('redrives only a current parked successor and preserves its original command id', async () => {
    const t = setup();
    t.accounts.mockRejectedValue(new Uncertain('ledger offline'));
    let n = await t.apply(t.create);
    for (let i = 0; i < 4; i++) n = await t.apply(n!.command);
    expect(n!.queue).toBe('payments.dlq');
    expect(await reviewCommand(pool, t.create.paymentId, 'other-company')).toBeNull();
    const command = await reviewCommand(pool, t.create.paymentId, 'horizonte');
    expect(command).toEqual(n!.command);
    t.accounts.mockResolvedValueOnce({ status: 'HELD' });
    await t.apply(command!);
    expect(await t.row()).toMatchObject({ state: 'AWAITING_SUBMISSION', review_required: false });
    expect(await reviewCommand(pool, t.create.paymentId)).toBeNull();
    expect(await t.events()).toContain('OPERATOR_REDRIVE');
  });
  it('audits a conflicting intent without mutating the original payment', async () => {
    const t = setup();
    await t.apply(t.create);
    await t.apply({ ...t.create, amountMinor: 999 });
    expect(await t.row()).toMatchObject({ amount_minor: '700', version: 1 });
    expect(await t.events()).toEqual(['PAYMENT_CREATED', 'IDEMPOTENCY_CONFLICT']);
  });
});
