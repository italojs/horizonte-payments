import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { transaction } from './connection.ts';

export async function migrate(pool: Pool) {
  const sql = await readFile(
    new URL('../../../database/migrations/001-initial.sql', import.meta.url),
    'utf8',
  );
  await transaction(pool, async (client) => {
    // Serialize initialization on concurrent starts, including on an existing installation.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('banks-schema', 0))");
    await client.query(sql);
  });
}
