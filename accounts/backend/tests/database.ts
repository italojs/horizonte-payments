import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate.ts';

export async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database for integration tests');
  const admin = new Pool({ connectionString: url });
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set('options', '-c search_path=' + schema);
  const pool = new Pool({ connectionString: scopedUrl.href });
  await admin.query('CREATE SCHEMA ' + schema);
  async function close() {
    try {
      await pool.end();
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    } finally {
      await admin.end();
    }
  }
  try {
    await migrate(pool);
  } catch (error) {
    await close();
    throw error;
  }
  function operator(...args: string[]) {
    const output = execFileSync(process.execPath, ['backend/scripts/operator.ts', ...args], {
      env: { ...process.env, ACCOUNTS_DB: scopedUrl.href, ALLOW_TEST_RESET: '1' },
      encoding: 'utf8',
    });
    return JSON.parse(output);
  }
  return { pool, operator, close };
}
