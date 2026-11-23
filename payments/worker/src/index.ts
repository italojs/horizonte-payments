import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ConsumeMessage } from 'amqplib';
import { connectBroker, queues } from '@horizonte/payments-runtime/broker';
import { database, transaction } from '@horizonte/payments-runtime/database';
import { makeServices } from './clients/providers.ts';
import { applyCommand } from './db/repositories/paymentCommands.ts';
import { validCommand } from './domain/commands.ts';
import { retryDelays } from './services/advancePayment.ts';
import { failpoint, arm, redrive } from './operations.ts';

const pool = database('PAYMENTS_DB');
const schema = await readFile(new URL('../../infra/payments.sql', import.meta.url), 'utf8');
await transaction(pool, async (db) => {
  // All replicas may start concurrently on a fresh database.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('payments/schema', 1))");
  await db.query(schema);
});

if (process.argv[2] === 'redrive') {
  try {
    await redrive(pool);
  } finally {
    await pool.end();
  }
} else if (process.argv[2] === 'failpoint') {
  try {
    await arm(pool);
  } finally {
    await pool.end();
  }
} else {
  retryDelays();
  const services = makeServices(pool);
  let stopping = false;
  let active: Awaited<ReturnType<typeof connectBroker>> | undefined;
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      stopping = true;
      void active?.close().catch(() => {});
    });
  while (!stopping) {
    try {
      const broker = await connectBroker();
      active = broker;
      async function handle(msg: ConsumeMessage, queue: string) {
        let input: unknown;
        try {
          input = JSON.parse(msg.content.toString('utf8'));
        } catch {
          input = null;
        }
        const expected =
          queue === queues.create ? 'create' : queue === queues.cancel ? 'cancel' : 'process';
        if (!validCommand(input) || input.kind !== expected) {
          const id = msg.properties.messageId || 'missing';
          await broker.send(
            queues.dlq,
            { error: 'INVALID_COMMAND', source: queue, messageId: id },
            id,
          );
          return;
        }
        const next = await applyCommand(pool, input, services, (id) =>
          failpoint(pool, 'after-provider', id),
        );
        if (next) {
          await failpoint(pool, 'after-commit', input.paymentId);
          await broker.publish(next.queue, next.command, next.availableAt);
        }
      }
      for (const queue of [queues.create, queues.cancel, queues.process, queues.retry]) {
        await broker.consume(queue, (msg) => handle(msg, queue));
      }
      console.log(JSON.stringify({ event: 'worker_ready' }));
      await broker.closed;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'broker_session_ended',
          error: err instanceof Error ? err.name : 'Error',
        }),
      );
    } finally {
      await active?.close().catch(() => {});
      active = undefined;
    }
    if (!stopping) await sleep(1000);
  }
  await pool.end();
}
