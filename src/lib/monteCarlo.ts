import type { FireSettings } from '../types';
import { drawdownParamsFrom, monthlyWithdrawals, planToAgeOf, targetConfidenceOf } from './fireEngine';

export interface MonteCarloResult {
  /** Fraction of simulated paths (0..1) where money lasted to endAge. */
  successRate: number;
  /** Combined wealth percentiles sampled yearly. Empty when the horizon is degenerate. */
  bands: { age: number; p10: number; p50: number; p90: number }[];
  runs: number;
}

export interface MonteCarloOptions {
  runs?: number;
  /** Defaults to the settings' planToAge (clamped). */
  endAge?: number;
  seed?: number;
}

/**
 * One shared seed for every simulation in the app. The earliest-age solver and
 * the sensitivity chips compare MC results against each other; with common
 * random numbers the deltas are real, with fresh seeds they'd be noise.
 */
export const MC_SEED = 12345;
export const DEFAULT_RUNS = 1000;

/** Deterministic PRNG so results are stable across renders and testable. */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate monthly lognormal real returns against the same contribution/drawdown
 * rules (fireEngine.monthlyWithdrawals) as the deterministic projection, retiring
 * every path at retireAge. A path fails if the accessible pot is exhausted before
 * pension access, or the combined pot is exhausted before endAge.
 */
export function runMonteCarlo(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
  retireAge: number,
  opts: MonteCarloOptions = {},
): MonteCarloResult {
  const runs = opts.runs ?? DEFAULT_RUNS;
  const endAge = opts.endAge ?? planToAgeOf(settings);
  const seed = opts.seed ?? MC_SEED;
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate } = settings;
  const dd = drawdownParamsFrom(settings);

  const realAnnual = (1 + expectedAnnualReturn / 100) / (1 + inflationRate / 100) - 1;
  const sigmaA = Math.max(settings.returnVolatility ?? 15, 0) / 100;
  const sigmaM = sigmaA / Math.sqrt(12);
  // Median-preserving drift with the lognormal -σ²/2 correction; at σ=0 this is
  // exactly the deterministic monthly growth factor.
  const muM = Math.log(1 + realAnnual) / 12 - (sigmaM * sigmaM) / 2;
  const monthlyPension = monthlyPensionContribution ?? 0;

  const months = Math.round((endAge - currentAge) * 12);
  if (months < 12 || runs <= 0) {
    return { successRate: 1, bands: [], runs: 0 };
  }
  const years = Math.floor(months / 12) + 1;

  const rng = mulberry32(seed);
  // Box–Muller produces pairs; keep the spare to halve rng calls.
  let spare: number | null = null;
  function normal(): number {
    if (sigmaM === 0) return 0;
    if (spare !== null) { const v = spare; spare = null; return v; }
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  }

  // samples[yearIndex] = combined wealth of every run at that age
  const samples: Float64Array[] = Array.from({ length: years }, () => new Float64Array(runs));
  let successes = 0;

  for (let run = 0; run < runs; run++) {
    let accessible = accessibleStart;
    let pension = pensionStart;
    let failed = false;

    for (let m = 0; m < months; m++) {
      const age = currentAge + m / 12;
      if (m % 12 === 0) {
        samples[m / 12][run] = Math.max(accessible, 0) + Math.max(pension, 0);
      }

      const growth = Math.exp(muM + sigmaM * normal());

      if (age < retireAge) {
        accessible = accessible * growth + monthlyContribution;
        pension = pension * growth + monthlyPension;
      } else {
        const w = monthlyWithdrawals(age, accessible, pension, dd);
        accessible = accessible * growth - w.fromAccessible;
        pension = pension * growth - w.fromPension;
        if (age < pensionAccessAge) {
          if (accessible < 0) {
            if (!failed) failed = true;
            accessible = 0; // keep simulating for the bands, but the path has failed
          }
        } else if (!failed && accessible + pension < 0) {
          failed = true;
        }
      }
    }
    const lastYear = Math.floor((months - 1) / 12);
    if (lastYear + 1 < years) samples[lastYear + 1][run] = Math.max(accessible, 0) + Math.max(pension, 0);

    if (!failed) successes++;
  }

  const bands = samples.map((yearSamples, i) => {
    const sorted = Array.from(yearSamples).sort((a, b) => a - b);
    return {
      age: Math.round(currentAge + i),
      p10: Math.round(sorted[Math.floor(0.10 * (runs - 1))]),
      p50: Math.round(sorted[Math.floor(0.50 * (runs - 1))]),
      p90: Math.round(sorted[Math.floor(0.90 * (runs - 1))]),
    };
  });

  return { successRate: successes / runs, bands, runs };
}

/**
 * Earliest retirement age (month resolution) whose Monte Carlo success rate
 * meets the settings' target confidence, or null if even retiring at
 * planToAge − 1 misses it. Success is non-decreasing in retirement age
 * (longer accumulation, shorter drawdown), so binary search is valid; every
 * evaluation reuses the same seed so the search is deterministic.
 */
export function solveEarliestFireAge(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
  opts: MonteCarloOptions = {},
): number | null {
  const { currentAge } = settings;
  const endAge = opts.endAge ?? planToAgeOf(settings);
  const target = targetConfidenceOf(settings) / 100;
  if (endAge <= currentAge + 1) return null;

  const mcOpts: MonteCarloOptions = {
    runs: opts.runs ?? DEFAULT_RUNS,
    seed: opts.seed ?? MC_SEED,
    endAge,
  };
  const meets = (monthsFromNow: number) =>
    runMonteCarlo(settings, accessibleStart, pensionStart, currentAge + monthsFromNow / 12, mcOpts)
      .successRate >= target;

  let lo = 0;
  let hi = Math.round((endAge - 1 - currentAge) * 12);
  if (!meets(hi)) return null;
  if (meets(lo)) return currentAge;
  // Invariant: meets(hi) && !meets(lo); find the smallest passing month.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(mid)) hi = mid; else lo = mid;
  }
  return currentAge + hi / 12;
}

/**
 * Success probability at whole-number retirement ages, for the confidence-vs-age
 * curve. Uses fewer runs than the headline number (chart resolution doesn't need
 * 1,000) but the same fixed seed. Stops once the rate clears 99% twice in a row,
 * or after 30 points.
 */
export function successCurve(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
  opts: MonteCarloOptions = {},
): { age: number; pct: number }[] {
  const endAge = opts.endAge ?? planToAgeOf(settings);
  const mcOpts: MonteCarloOptions = { runs: opts.runs ?? 400, seed: opts.seed ?? MC_SEED, endAge };
  const start = Math.ceil(settings.currentAge);
  const points: { age: number; pct: number }[] = [];
  let clearedTarget = 0;

  for (let i = 0; i < 30; i++) {
    const age = start + i;
    if (age >= endAge) break;
    const { successRate } = runMonteCarlo(settings, accessibleStart, pensionStart, age, mcOpts);
    points.push({ age, pct: Math.round(successRate * 1000) / 10 });
    clearedTarget = successRate > 0.99 ? clearedTarget + 1 : 0;
    if (clearedTarget >= 2) break;
  }
  return points;
}
