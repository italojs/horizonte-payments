import Fastify, { LogController } from 'fastify';
import { registerPaymentRoutes } from './routes/payments.ts';
import { PaymentError, type PaymentService } from '../services/payments.ts';

export function buildServer(service: PaymentService) {
  const app = Fastify({
    bodyLimit: 32768,
    logger: { level: 'warn', redact: ['req.headers'] },
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PaymentError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof Error && 'validation' in error)
      return reply.code(400).send({ error: error.message });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ error: error.message });
    request.log.error({ err: error }, 'Payment request failed');
    return reply.code(500).send({ error: 'Payment request failed' });
  });
  app.get('/health', async () => ({ ok: true }));
  app.register(async (api) => registerPaymentRoutes(api, service), { prefix: '/api' });
  return app;
}
