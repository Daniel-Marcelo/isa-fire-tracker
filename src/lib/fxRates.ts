// Rates are relative to GBP base: { USD: 1.27, EUR: 1.17, GBP: 1, ... }
// Convert amount from `from` to `to`: amount * (rates[to] / rates[from])
export type FxRates = Record<string, number>;

export async function fetchFxRates(): Promise<FxRates> {
  const res = await fetch('https://api.frankfurter.dev/v1/latest?base=GBP');
  if (!res.ok) return { GBP: 1 };
  const data = await res.json();
  return { GBP: 1, ...data.rates } as FxRates;
}

// Normalise currency codes — Yahoo Finance returns GBp (pence) for LSE stocks.
// Convert pence to pounds before doing FX.
function normalise(amount: number, currency: string): { amount: number; currency: string } {
  if (currency === 'GBp') return { amount: amount / 100, currency: 'GBP' };
  return { amount, currency };
}

export function convertAmount(amount: number, from: string, to: string, rates: FxRates): number {
  const n = normalise(amount, from);
  if (n.currency === to || Object.keys(rates).length === 0) return n.amount;
  const fromRate = rates[n.currency] ?? 1;
  const toRate = rates[to] ?? 1;
  return n.amount * (toRate / fromRate);
}
