import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import type { Channel, ConsumeMessage } from 'amqplib';
import { context, propagation, withSpan } from './telemetry.ts';

export const queues = {
  create: 'payments.create',
  process: 'payments.process',
  retry: 'payments.retry',
  cancel: 'payments.cancel',
  dlq: 'payments.dlq',
} as const;

export interface Command {
  id: string;
  kind: 'create' | 'cancel' | 'process';
  paymentId: string;
  companyId: string;
  actor: string;
  accountId?: string;
  billRef?: string;
  amountMinor?: number;
  beneficiaryRef?: string;
  currency?: string;
  idempotencyKey?: string;
  reason?: string;
  version?: number;
}

export async function connectBroker(
  url = process.env.AMQP_URL,
  options: { declare?: boolean; exchange?: string } = {},
) {
  if (!url) throw new Error('AMQP_URL is required');
  const connection = await amqp.connect(url, { timeout: 5000 });
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  connection.on('error', () => {});
  connection.on('close', finish);
  const [major, minor] = connection.connection.serverProperties.version.split('.').map(Number);
  if (!(major > 4 || (major === 4 && minor >= 4))) {
    await connection.close();
    throw new Error('Scheduled quorum delivery requires RabbitMQ 4.4 or later');
  }
  const publisher = await connection.createConfirmChannel().catch(async (error) => {
    await connection.close().catch(() => {});
    throw error;
  });
  publisher.on('error', () => {});
  publisher.on('close', finish);
  // A quorum queue's default finite delivery limit can drop an unacknowledged
  // financial command after infrastructure crashes. Business retries are bounded separately.
  try {
    if (options.declare !== false) {
      for (const queue of Object.values(queues)) {
        await publisher.assertQueue(queue, {
          durable: true,
          arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1 },
        });
      }
    }
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
  const returned = new Set<string>();
  publisher.on('return', (message) => {
    returned.add(message.properties.correlationId);
  });

  async function publish(queue: string, command: Command, availableAt?: number) {
    await send(queue, command, command.id, availableAt);
  }

  async function send(queue: string, payload: unknown, messageId: string, availableAt?: number) {
    await withSpan(
      'rabbitmq publish ' + queue,
      async () => {
        const correlationId = randomUUID();
        const headers: Record<string, unknown> = {};
        propagation.inject(context.active(), headers);
        if (availableAt !== undefined)
          headers['x-opt-delivery-time'] = { '!': 'int64', value: availableAt };
        let deadline: NodeJS.Timeout | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            // A live TCP connection may stop receiving confirms during broker resource alarms.
            deadline = setTimeout(() => {
              finish();
              void connection.close().catch(() => {});
              reject(new Error('Publisher confirm timed out'));
            }, 5000);
            publisher.publish(
              options.exchange ?? '',
              queue,
              Buffer.from(JSON.stringify(payload)),
              {
                persistent: true,
                mandatory: true,
                messageId,
                correlationId,
                headers,
                contentType: 'application/json',
              },
              (err: Error | null) => {
                if (err) reject(err);
                else if (returned.has(correlationId))
                  reject(new Error('Message was not routed to ' + queue));
                else resolve();
              },
            );
          });
        } finally {
          clearTimeout(deadline);
          returned.delete(correlationId);
        }
      },
      {
        'messaging.system': 'rabbitmq',
        'messaging.destination.name': queue,
        'messaging.message.id': messageId,
      },
    );
  }

  async function consume(
    queue: string,
    handler: (msg: ConsumeMessage, channel: Channel) => Promise<void>,
  ) {
    const channel = await connection.createChannel();
    channel.on('error', () => {});
    channel.on('close', finish);
    await channel.prefetch(1);
    await channel.consume(
      queue,
      (msg) => {
        if (!msg) {
          finish();
          return;
        }
        const parent = propagation.extract(context.active(), msg.properties.headers || {});
        void context
          .with(parent, () =>
            withSpan(
              'rabbitmq consume ' + queue,
              async () => {
                await handler(msg, channel);
                channel.ack(msg);
              },
              {
                'messaging.system': 'rabbitmq',
                'messaging.destination.name': queue,
                'messaging.message.id': String(msg.properties.messageId || ''),
                'messaging.rabbitmq.redelivered': msg.fields.redelivered,
              },
            ),
          )
          .catch((error: Error) => {
            console.error(JSON.stringify({ event: 'delivery_requeued', queue, error: error.name }));
            // Closing the channel requeues every unacknowledged delivery and the
            // supervisor reconnects with backoff; a failed confirm never leads to ACK.
            void channel.close().catch(() => {});
          });
      },
      { noAck: false },
    );
  }

  return { publish, send, consume, closed, close: () => connection.close() };
}
