import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { positiveEnv } from '../../config.ts';
import { CircuitOpen } from '../../domain/payment.ts';

type Permit = { generation: string; probe: string | null };
export async function acquire(pool: Pool, timeout: number): Promise<Permit> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      rows: [row],
    } = await client.query(
      "SELECT *, EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS now_ms FROM bank_breaker WHERE name='provider' FOR UPDATE",
    );
    const now = Number(row.now_ms);
    const next = Math.max(row.open_until?.getTime() || 0, row.probe_until?.getTime() || 0);
    if (next > now) throw new CircuitOpen(next);
    const probe = row.open_until ? randomUUID() : null;
    if (probe) {
      await client.query(
        "UPDATE bank_breaker SET probe=$1, probe_until=clock_timestamp()+$2*interval '1 millisecond' WHERE name='provider'",
        [probe, timeout + 1000],
      );
    }
    await client.query('COMMIT');
    return { generation: row.generation, probe };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function record(pool: Pool, permit: Permit, success: boolean) {
  if (success) {
    await pool.query(
      `UPDATE bank_breaker SET failures=0, open_until=NULL, probe=NULL, probe_until=NULL,
      generation=generation + CASE WHEN probe IS NULL THEN 0 ELSE 1 END
      WHERE name='provider' AND generation=$1 AND probe IS NOT DISTINCT FROM $2::uuid`,
      [permit.generation, permit.probe],
    );
    return;
  }
  await pool.query(
    `UPDATE bank_breaker SET failures=failures+1, probe=NULL, probe_until=NULL,
    open_until=CASE WHEN probe IS NOT NULL OR failures+1 >= $3
      THEN clock_timestamp()+$4*interval '1 millisecond' ELSE NULL END,
    generation=generation + CASE WHEN probe IS NOT NULL OR failures+1 >= $3 THEN 1 ELSE 0 END
    WHERE name='provider' AND generation=$1 AND probe IS NOT DISTINCT FROM $2::uuid`,
    [
      permit.generation,
      permit.probe,
      positiveEnv('BREAKER_THRESHOLD', 3),
      positiveEnv('BREAKER_COOLDOWN_MS', 30_000),
    ],
  );
}
