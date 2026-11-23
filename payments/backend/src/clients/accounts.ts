import { context, propagation, withSpan } from '@horizonte/payments-runtime/telemetry';

export function accountsClient(baseUrl: string) {
  return async (company: string) =>
    withSpan('accounts.balance', async () => {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);
      const response = await fetch(new URL('/accounts/' + encodeURIComponent(company), baseUrl), {
        headers,
        signal: AbortSignal.timeout(3500),
      });
      if (!response.ok) throw new Error('Accounts is unavailable');
      const { availableMinor, currency } = (await response.json()) as {
        availableMinor: number;
        currency: string;
      };
      if (!Number.isSafeInteger(availableMinor) || typeof currency !== 'string')
        throw new Error('Invalid account balance');
      return { availableMinor, currency };
    });
}
