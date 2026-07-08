import type { AppData, AllocationTarget, Holding } from '../types';

export interface Position {
  key: string;   // uppercase ticker, or exact name for ticker-less holdings
  label: string; // display name (first holding encountered)
  value: number; // display-currency current value, summed across providers
}

export function positionKey(h: Pick<Holding, 'ticker' | 'name'>): string {
  const ticker = h.ticker?.trim();
  // Tickers are case-insensitive; names are opaque strings and stay as typed.
  return ticker ? ticker.toUpperCase() : h.name.trim();
}

/**
 * Aggregate holdings across all providers by position key. Operates on the
 * *display* data (derived currentValue in display currency).
 */
export function aggregatePositions(data: AppData): Position[] {
  const map = new Map<string, Position>();
  for (const provider of data.providers) {
    for (const h of provider.holdings) {
      const key = positionKey(h);
      if (!key) continue;
      const value = h.currentValue ?? 0;
      const existing = map.get(key);
      if (existing) {
        existing.value += value;
      } else {
        map.set(key, { key, label: h.name, value });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

export interface BuyPlanRow {
  key: string;
  buy: number; // display-currency amount to buy (>= 0)
}

/**
 * Buy-only rebalance: split `contribution` across targeted positions so the
 * portfolio moves toward target without selling.
 *
 * Only positions with a target participate; target percentages are normalised
 * to their own sum, so 32/8 behaves identically to 80/20.
 */
export function planNewMoney(
  positions: Position[],
  targets: AllocationTarget[],
  contribution: number,
): BuyPlanRow[] {
  const active = targets.filter(t => t.targetPct > 0);
  if (contribution <= 0 || active.length === 0) return [];

  const pctSum = active.reduce((s, t) => s + t.targetPct, 0);
  if (pctSum <= 0) return [];

  const valueByKey = new Map(positions.map(p => [p.key, p.value]));
  const targetedValue = active.reduce((s, t) => s + (valueByKey.get(t.key) ?? 0), 0);
  const total = targetedValue + contribution;

  const rows = active.map(t => {
    const frac = t.targetPct / pctSum;
    const current = valueByKey.get(t.key) ?? 0;
    return { key: t.key, frac, deficit: Math.max(0, frac * total - current) };
  });

  const totalDeficit = rows.reduce((s, r) => s + r.deficit, 0);
  let buys: BuyPlanRow[];
  if (totalDeficit >= contribution) {
    // Not enough new money to fully rebalance: fill deficits proportionally.
    buys = rows.map(r => ({ key: r.key, buy: totalDeficit > 0 ? contribution * (r.deficit / totalDeficit) : 0 }));
  } else {
    // Fill every deficit, then spread the remainder by target weight.
    const remainder = contribution - totalDeficit;
    buys = rows.map(r => ({ key: r.key, buy: r.deficit + remainder * r.frac }));
  }

  // Round to pennies and push the residue into the largest buy so rows sum
  // exactly to the contribution.
  buys = buys.map(b => ({ ...b, buy: Math.round(b.buy * 100) / 100 }));
  const roundedSum = buys.reduce((s, b) => s + b.buy, 0);
  const residue = Math.round((contribution - roundedSum) * 100) / 100;
  if (residue !== 0 && buys.length > 0) {
    const largest = buys.reduce((a, b) => (b.buy > a.buy ? b : a));
    largest.buy = Math.round((largest.buy + residue) * 100) / 100;
  }
  return buys.filter(b => b.buy > 0);
}
