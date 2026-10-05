import type { FireSettings } from '../types';
import {
  cashAnnualReturnOf,
  drawdownParamsFrom,
  monthlyWithdrawals,
  planToAgeOf,
  rawAccessible,
  rawTotal,
  sumAll,
  targetConfidenceOf,
  type FirePots,
} from './fireEngine';

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

function clonePots(p: FirePots): FirePots {
  return { cash: p.cash, isa: p.isa, gia: p.gia, pension: p.pension };
}

/**
 * Simulate monthly lognormal real returns against the same contribution/drawdown
 * rules (fireEngine.monthlyWithdrawals) as the deterministic projection, retiring
 * every path at retireAge. Cash compounds at its own (deterministic) real rate;
 * ISA/GIA/pension share the equity shock. A path fails if the bridge can't be
 * funded before pension access, or the combined pot is exhausted before endAge.
 */
export function runMonteCarlo(
  settings: FireSettings,
  pots0: FirePots,
  retireAge: number,
  opts: MonteCarloOptions = {},
): MonteCarloResult {
  const runs = opts.runs ?? DEFAULT_RUNS;
  const endAge = opts.endAge ?? planToAgeOf(settings);
  const seed = opts.seed ?? MC_SEED;
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate } = settings;
  const dd = drawdownParamsFrom(settings);

  const realAnnual = (1 + expectedAnnualReturn / 100) / (1 + inflationRate / 100) - 1;
  const cashRealAnnual = (1 + cashAnnualReturnOf(settings) / 100) / (1 + inflationRate / 100) - 1;
  const cashGrowth = Math.pow(1 + cashRealAnnual, 1 / 12); // deterministic; σ = 0
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

  const samples: Float64Array[] = Array.from({ length: years }, () => new Float64Array(runs));
  let successes = 0;

  for (let run = 0; run < runs; run++) {
    let pots = clonePots(pots0);
    let failed = false;

    for (let m = 0; m < months; m++) {
      const age = currentAge + m / 12;
      if (m % 12 === 0) {
        samples[m / 12][run] = sumAll(pots);
      }

      const equityGrowth = Math.exp(muM + sigmaM * normal());
      pots = {
        cash: pots.cash * cashGrowth,
        isa: pots.isa * equityGrowth,
        gia: pots.gia * equityGrowth,
        pension: pots.pension * equityGrowth,
      };

      if (age < retireAge) {
        pots.isa += monthlyContribution;
        pots.pension += monthlyPension;
      } else {
        const w = monthlyWithdrawals(age, pots, dd);
        pots.cash -= w.fromCash;
        pots.isa -= w.fromIsa;
        pots.gia -= w.fromGia;
        pots.pension -= w.fromPension;
        if (age < pensionAccessAge) {
          if (w.unmetNeed > 0 || rawAccessible(pots) < 0) {
            if (!failed) failed = true;
            pots.cash = Math.max(pots.cash, 0);
            pots.isa = Math.max(pots.isa, 0);
            pots.gia = Math.max(pots.gia, 0);
          }
        } else if (!failed && rawTotal(pots) < 0) {
          failed = true;
        }
      }
    }
    const lastYear = Math.floor((months - 1) / 12);
    if (lastYear + 1 < years) samples[lastYear + 1][run] = Math.max(sumAll(pots), 0);

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
 * planToAge − 1 misses it.
 */
export function solveEarliestFireAge(
  settings: FireSettings,
  pots: FirePots,
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
    runMonteCarlo(settings, pots, currentAge + monthsFromNow / 12, mcOpts)
      .successRate >= target;

  let lo = 0;
  let hi = Math.round((endAge - 1 - currentAge) * 12);
  if (!meets(hi)) return null;
  if (meets(lo)) return currentAge;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(mid)) hi = mid; else lo = mid;
  }
  return currentAge + hi / 12;
}

/**
 * Smallest total monthly contribution (ISA + pension combined) whose Monte Carlo
 * success rate at `retireAge` meets the settings' target confidence, holding the
 * current ISA:pension contribution ratio fixed. Returns null if unreachable, 0 if
 * current pots already suffice with no contributions.
 */
export function solveRequiredContribution(
  settings: FireSettings,
  pots: FirePots,
  retireAge: number,
  opts: MonteCarloOptions = {},
): number | null {
  if (retireAge <= settings.currentAge) return null;

  const target = targetConfidenceOf(settings) / 100;
  const acc0 = Math.max(settings.monthlyContribution, 0);
  const pen0 = Math.max(settings.monthlyPensionContribution ?? 0, 0);
  const base = acc0 + pen0;
  // Split ratio: if the user contributes nothing today, route new money to ISA
  // (the bridge pot that usually binds for early retirement).
  const isaShare = base > 0 ? acc0 / base : 1;

  const rateAt = (total: number) => {
    const s2: FireSettings = {
      ...settings,
      monthlyContribution: total * isaShare,
      monthlyPensionContribution: total * (1 - isaShare),
    };
    return runMonteCarlo(s2, pots, retireAge,
      { runs: opts.runs ?? DEFAULT_RUNS, seed: opts.seed ?? MC_SEED, endAge: opts.endAge }).successRate;
  };

  if (rateAt(0) >= target) return 0;

  let hi = Math.max(base, 500);
  let guard = 0;
  while (rateAt(hi) < target) {
    hi *= 2;
    if (++guard > 20) return null;
  }
  let lo = 0;
  while (hi - lo > 10) {
    const mid = (lo + hi) / 2;
    if (rateAt(mid) >= target) hi = mid; else lo = mid;
  }
  return Math.ceil(hi / 10) * 10;
}

/**
 * Success probability at whole-number retirement ages, for the confidence-vs-age
 * curve.
 */
export function successCurve(
  settings: FireSettings,
  pots: FirePots,
  opts: MonteCarloOptions = {},
): { age: number; pct: number }[] {
  const endAge = opts.endAge ?? planToAgeOf(settings);
  const mcOpts: MonteCarloOptions = { runs: opts.runs ?? 400, seed: opts.seed ?? MC_SEED, endAge };
  const ageStart = Math.ceil(settings.currentAge);
  const points: { age: number; pct: number }[] = [];
  let clearedTarget = 0;

  for (let i = 0; i < 30; i++) {
    const age = ageStart + i;
    if (age >= endAge) break;
    const { successRate } = runMonteCarlo(settings, pots, age, mcOpts);
    points.push({ age, pct: Math.round(successRate * 1000) / 10 });
    clearedTarget = successRate > 0.99 ? clearedTarget + 1 : 0;
    if (clearedTarget >= 2) break;
  }
  return points;
}
