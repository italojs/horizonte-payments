import { connectBroker, type Command } from '@horizonte/payments-runtime/broker';

export function commandPublisher(url: string) {
  let session: ReturnType<typeof connectBroker> | undefined;
  return {
    async publish(queue: string, command: Command) {
      if (!session) {
        const pending = connectBroker(url, { declare: false, exchange: 'payments.intake' });
        session = pending;
        void pending
          .then((broker) => broker.closed)
          .catch(() => {})
          .finally(() => {
            if (session === pending) session = undefined;
          });
      }
      const broker = await session;
      await broker.publish(queue, command);
    },
    async close() {
      const broker = await session?.catch(() => undefined);
      await broker?.close().catch(() => {});
    },
  };
}
