import type { AppData, Provider, Holding } from '../types';
import { convertAmount, type FxRates } from './fxRates';
import { PRICE_SNAPSHOT_MAX_AGE_MS } from './firebasePrices';

/** Epoch ms each ticker's price was last refreshed by the feed. */
export type PriceAges = Record<string, number | null>;

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Value of a holding in its native currency, or null if it cannot be valued reliably
 * (ticker'd holding with units but no live price this session).
 */
export function holdingNativeValue(h: Holding, livePrices: Record<string, number>): number | null {
  if (h.ticker && h.units != null) {
    const price = livePrices[h.ticker];
    if (price != null) return h.units * price;
    return h.manualValue ?? null; // last-saved value beats nothing, but see provider rule below
  }
  return h.manualValue ?? 0;
}

/**
 * Provider total in GBP, or null if the provider can't be valued trustworthily:
 * - any ticker'd holding with units has no live price, or
 * - that price is older than PRICE_SNAPSHOT_MAX_AGE_MS (or can't be dated), or
 * - any holding's currency is missing from fxRates (non-GBP with no rate).
 *
 * Snapshots are permanent history, so an undateable price is treated as stale:
 * displaying a price we can't vouch for is fine, recording it as fact is not.
 */
export function providerGbpTotal(
  p: Provider,
  livePrices: Record<string, number>,
  fxRates: FxRates,
  priceAges: PriceAges = {},
  now: number = Date.now(),
): number | null {
  if (p.holdings.length === 0) return null;
  let total = 0;
  for (const h of p.holdings) {
    // Only ticker'd holdings are priced by the feed; cash and manual-value
    // holdings have no price and must never be blocked by staleness.
    if (h.ticker && h.units != null) {
      if (livePrices[h.ticker] == null) return null;
      const asOf = priceAges[h.ticker];
      if (asOf == null || now - asOf > PRICE_SNAPSHOT_MAX_AGE_MS) return null;
    }
    const native = holdingNativeValue(h, livePrices);
    if (native == null) return null;
    const currency = h.currency ?? 'GBP';
    if (currency !== 'GBP' && fxRates[currency] == null) return null;
    total += convertAmount(native, currency, 'GBP', fxRates);
  }
  return total;
}

/**
 * Return data with today's snapshot upserted for every valuable provider.
 * MUST return the same object reference when nothing changed, so callers can
 * cheaply skip re-saving.
 */
export function withTodaySnapshots(
  data: AppData,
  livePrices: Record<string, number>,
  fxRates: FxRates,
  priceAges: PriceAges = {},
  now: number = Date.now(),
): AppData {
  const date = todayKey();
  let changed = false;
  const providers = data.providers.map(p => {
    const total = providerGbpTotal(p, livePrices, fxRates, priceAges, now);
    if (total == null) return p;
    const existing = p.snapshots.find(s => s.date === date);
    if (existing && Math.abs(existing.totalValue - total) < 0.01) return p;
    changed = true;
    const snapshots = [...p.snapshots.filter(s => s.date !== date), { date, totalValue: total }]
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ...p, snapshots };
  });
  return changed ? { ...data, providers } : data;
}
