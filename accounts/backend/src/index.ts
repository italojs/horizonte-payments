import { database } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { shutdownTelemetry } from './observability/instrument.ts';
import { createServer } from './server/index.ts';

const pool = database();
const app = createServer(pool);
async function close() {
  try {
    await app.close();
  } finally {
    await pool.end();
    await shutdownTelemetry();
  }
}
try {
  await migrate(pool);
  await app.listen({ port: Number(process.env.PORT ?? 3011), host: process.env.HOST ?? '0.0.0.0' });
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
} catch (error) {
  await close();
  throw error;
}
