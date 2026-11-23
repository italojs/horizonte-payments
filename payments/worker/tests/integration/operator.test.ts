import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/db/repositories/paymentCommands.ts';
import { makeServices } from '../../src/clients/providers.ts';
import { paymentRepository } from '../../../backend/src/db/repositories/payments.ts';

const execute = promisify(execFile);
const url = process.env.PAYMENTS_TEST_DB;
describe.skipIf(!url)('Payments operations', () => {
  const schema = 'operator_test_' + randomUUID().replaceAll('-', '');
  let admin: Pool, database: Pool, connectionString: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query('CREATE SCHEMA ' + schema);
    const connection = new URL(url!);
    connection.searchParams.set('options', '-c search_path=' + schema);
    connectionString = connection.href;
    database = new Pool({ connectionString });
    await database.query(
      await readFile(new URL('../../../infra/payments.sql', import.meta.url), 'utf8'),
    );
  });
  afterAll(async () => {
    await database?.end();
    if (admin) {
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    }
  });
  async function operator(args: string[], allow = false) {
    const { stdout } = await execute(process.execPath, ['backend/scripts/operator.ts', ...args], {
      env: { ...process.env, PAYMENTS_DB: connectionString, ALLOW_TEST_RESET: allow ? '1' : '0' },
    });
    return JSON.parse(stdout);
  }
  it('inspects the same stored audit trail as the API, lists routes and gates test resets', async () => {
    const id = randomUUID();
    await applyCommand(
      database,
      {
        id: id + '/create',
        kind: 'create',
        paymentId: id,
        companyId: 'horizonte',
        actor: 'payments-api',
        currency: 'BRL',
        idempotencyKey: id,
        accountId: 'acc-horizonte',
        beneficiaryRef: 'ipe',
        billRef: 'ipe-192',
        amountMinor: 85000,
      },
      makeServices(database),
      async () => {},
    );
    const inspected = await operator(['inspect', id]);
    expect(inspected).toMatchObject({
      payment: { id, amountMinor: 85000 },
      version: 1,
      attempt: 0,
      state: 'RESERVATION_PENDING',
    });
    const repository = paymentRepository(database);
    const detail = await repository.detail('horizonte', id);
    expect(detail?.events).toEqual(
      inspected.events.map(({ eventType, actor, createdAt }: Record<string, string>) => ({
        eventType,
        actor,
        createdAt,
      })),
    );
    expect(detail?.events[0].eventType).toBe('PAYMENT_CREATED');
    expect(await repository.detail('other-company', id)).toBeUndefined();
    expect(await operator(['routes', id])).toEqual(['payments.process']);
    expect(await operator(['breaker'])).toMatchObject({ state: 'CLOSED', failures: 0 });
    await expect(operator(['reset', '--test'])).rejects.toThrow('ALLOW_TEST_RESET');
    expect((await operator(['inspect', id])).payment.id).toBe(id);
    expect(await operator(['reset', '--test'], true)).toEqual({ reset: true });
    expect((await operator(['inspect', id])).payment).toBeNull();
  });
});
