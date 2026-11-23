import type { Pool } from 'pg';
import { accounts } from './accounts.ts';
import { bankClient } from './banks.ts';

export function makeServices(pool: Pool) {
  return { bank: bankClient(pool), accounts };
}
export type Services = ReturnType<typeof makeServices>;
