export type BankAction = 'submit' | 'cancel' | 'query';
export type BankState = 'PAID' | 'PROCESSING' | 'CANCELLED' | 'REJECTED';
export function decideBank(
  action: BankAction,
  current: BankState | null,
  mode: string,
): BankState | null {
  if (current && current !== 'PROCESSING') return current;
  if (action === 'cancel') return 'CANCELLED';
  if (action === 'query' && !current) return null;
  if (mode === 'pending') return 'PROCESSING';
  if (mode === 'reject') return 'REJECTED';
  return 'PAID';
}
