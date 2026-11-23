import { env } from '@horizonte/payments-runtime/config';
import { database } from '@horizonte/payments-runtime/database';
import { accountsClient } from './clients/accounts.ts';
import { commandPublisher } from './clients/commandPublisher.ts';
import { paymentRepository } from './db/repositories/payments.ts';
import { paymentService } from './services/payments.ts';
import { buildServer } from './server/index.ts';

const pool = database('PAYMENTS_DB');
const broker = commandPublisher(env('AMQP_URL'));
const service = paymentService({
  repository: paymentRepository(pool),
  publish: broker.publish,
  balance: accountsClient(env('ACCOUNTS_URL')),
});
const app = buildServer(service);
app.addHook('onClose', async () => {
  await Promise.all([pool.end(), broker.close()]);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ port: Number(process.env.PORT ?? 3010), host: process.env.HOST ?? '0.0.0.0' });
