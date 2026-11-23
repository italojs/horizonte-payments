export type AccountAction = 'reserve' | 'capture' | 'release';
export type HoldState = 'HELD' | 'CAPTURED' | 'RELEASED';
export function decideReservation(
  action: AccountAction,
  current: HoldState | null,
  amount: number,
  available: number,
) {
  const unchanged = { code: 200, status: current, balanceDelta: 0, reservedDelta: 0 };
  if (action === 'reserve') {
    if (current) return unchanged;
    if (available < amount) return { ...unchanged, code: 422 };
    return { ...unchanged, status: 'HELD' as const, reservedDelta: amount };
  }
  if (action === 'release') {
    if (current === 'CAPTURED') return { ...unchanged, code: 409 };
    return {
      ...unchanged,
      status: 'RELEASED' as const,
      reservedDelta: current === 'HELD' ? -amount : 0,
    };
  }
  if (current === 'CAPTURED') return unchanged;
  if (current !== 'HELD') return { ...unchanged, code: 409 };
  return {
    ...unchanged,
    status: 'CAPTURED' as const,
    balanceDelta: -amount,
    reservedDelta: -amount,
  };
}
