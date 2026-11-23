import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { connectBroker, type Command } from '@horizonte/payments-runtime/broker';

const url = process.env.AMQP_TEST_URL;
it.skipIf(!url)(
  'rejects unroutable confirms and recovers a delayed, unacknowledged quorum delivery',
  async () => {
    const admin = await amqp.connect(url!);
    const channel = await admin.createChannel();
    const broker = await connectBroker(url);
    const name = 'saga-adapter-test-' + randomUUID();
    try {
      await channel.assertQueue(name, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
      const cmd: Command = {
        id: randomUUID(),
        kind: 'process',
        paymentId: randomUUID(),
        companyId: 'horizonte',
        actor: 'test',
        version: 1,
      };
      await expect(broker.publish(name + '-absent', cmd)).rejects.toThrow('not routed');
      const due = Date.now() + 1200;
      await broker.publish(name, cmd, due);
      // The broker and test process may run on different hosts. A safe distance
      // from the broker deadline distinguishes native scheduling from immediate routing.
      await sleep(250);
      expect(await channel.get(name, { noAck: false })).toBe(false);
      let receivedAt = 0,
        receivedId = '';
      await broker.consume(name, async (msg) => {
        receivedAt = Date.now();
        receivedId = String(msg.properties.messageId);
        throw Error('simulated hand-off failure');
      });
      await broker.closed;
      expect(receivedAt).toBeGreaterThanOrEqual(due - 250);
      expect(receivedId).toBe(cmd.id);
      const deadline = Date.now() + 1500;
      let msg = await channel.get(name, { noAck: false });
      while (!msg && Date.now() < deadline) {
        await sleep(30);
        msg = await channel.get(name, { noAck: false });
      }
      if (!msg) throw Error('Lost unacknowledged delivery');
      expect(msg.fields.redelivered).toBe(true);
      expect(JSON.parse(msg.content.toString())).toEqual(cmd);
      channel.ack(msg);
    } finally {
      await broker.close().catch(() => {});
      await channel.deleteQueue(name);
      await admin.close();
    }
  },
);
