import type { FireSettings } from '../types';
import { planToAgeOf, type FirePots } from './fireEngine';
import { HISTORICAL_REAL_RETURNS, type HistoricalYear } from './historicalReturns';
import { pathSetup, simulatePath } from './simulatePath';

export interface BacktestResult {
  /** Fraction of historical start years (0..1) where the money lasted. */
  successRate: number;
  cycles: number;
  failedStartYears: number[];
  firstYear: number | null;
  lastYear: number | null;
}

/**
 * Monthly equity growth factors for one historical series. Deviations are applied
 * in log space, so the compound average of the series equals the user's real
 * return: history sets the order and size of good and bad years, not the
 * long-run growth. Floored so an extreme shock can't produce a negative factor.
 */
export function monthlyGrowthFactors(realAnnual: number, returns: HistoricalYear[]): number[] {
  const n = returns.length;
  if (n === 0) return [];
  const logUser = Math.log(Math.max(1 + realAnnual, 0.01));
  const logs = returns.map(r => Math.log(Math.max(1 + r.real, 0.01)));
  const meanLog = logs.reduce((s, x) => s + x, 0) / n;
  return logs.map(lh => Math.exp((logUser + lh - meanLog) / 12));
}

/**
 * Replay the plan from every historical start year. Each year keeps the settings'
 * expected compound real return and adds that year's deviation from the dataset,
 * so history sets the order and size of good and bad years while the long-run
 * growth stays the user's assumption. Windows that run past the last year wrap
 * to the first, so every start year gets a full horizon.
 */
export function runBacktest(
  settings: FireSettings,
  pots0: FirePots,
  retireAge: number,
  opts: { endAge?: number; returns?: HistoricalYear[] } = {},
): BacktestResult {
  const returns = opts.returns ?? HISTORICAL_REAL_RETURNS;
  const setup = pathSetup(settings, retireAge, opts.endAge ?? planToAgeOf(settings));
  const n = returns.length;
  if (setup.months < 12 || n === 0) {
    return { successRate: 1, cycles: 0, failedStartYears: [], firstYear: null, lastYear: null };
  }

  const monthly = monthlyGrowthFactors(setup.realAnnual, returns);

  const failedStartYears: number[] = [];
  for (let k = 0; k < n; k++) {
    const { failed } = simulatePath(setup, pots0, m => monthly[(k + Math.floor(m / 12)) % n]);
    if (failed) failedStartYears.push(returns[k].year);
  }

  return {
    successRate: 1 - failedStartYears.length / n,
    cycles: n,
    failedStartYears,
    firstYear: returns[0].year,
    lastYear: returns[n - 1].year,
  };
}

/** "1906, 1929–1931, 1966" from ascending years. */
export function formatYearRanges(years: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < years.length) {
    let j = i;
    while (j + 1 < years.length && years[j + 1] === years[j] + 1) j++;
    parts.push(j === i ? `${years[i]}` : `${years[i]}–${years[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}
