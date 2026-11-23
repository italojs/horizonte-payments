import { Pool, type PoolClient } from 'pg';
import { env } from './config.ts';

export function database(name: string) {
  return new Pool({ connectionString: env(name), max: 12, connectionTimeoutMillis: 5000 });
}
export async function transaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
