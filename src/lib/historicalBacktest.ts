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
 * Replay the plan from every historical start year. Each year keeps the settings'
 * expected real return and adds that year's deviation from the dataset mean, so
 * history sets the order and size of good and bad years while the long-run
 * average stays the user's assumption. Windows that run past the last year wrap
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

  const mean = returns.reduce((s, r) => s + r.real, 0) / n;
  // Floor at −99% so an extreme shock on a low assumption can't produce a negative factor.
  const monthly = returns.map(r => Math.pow(Math.max(1 + setup.realAnnual + r.real - mean, 0.01), 1 / 12));

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
