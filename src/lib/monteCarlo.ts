import type { FireSettings } from '../types';
import { planToAgeOf, type FirePots } from './fireEngine';
import { pathSetup, simulatePath } from './simulatePath';

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
 * One shared seed for every simulation in the app. The headline and the
 * sensitivity chips compare MC results against each other; with common
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
 * Simulate monthly lognormal real returns, retiring every path at retireAge. Each
 * path runs through simulatePath, which shares its contribution, drawdown and
 * failure rules with the historical backtest. Cash compounds at its own
 * (deterministic) real rate; ISA/GIA/pension share the equity shock.
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
  const setup = pathSetup(settings, retireAge, endAge);
  if (setup.months < 12 || runs <= 0) {
    return { successRate: 1, bands: [], runs: 0 };
  }

  const sigmaA = Math.max(settings.returnVolatility ?? 15, 0) / 100;
  const sigmaM = sigmaA / Math.sqrt(12);
  // Median-preserving drift: the median path compounds at the user's real return,
  // the same rate as the steady plan. The mean outcome is higher by about σ²/2.
  const muM = Math.log(Math.max(1 + setup.realAnnual, 0.01)) / 12;

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

  const samples: Float64Array[] = Array.from({ length: setup.years }, () => new Float64Array(runs));
  let successes = 0;
  for (let run = 0; run < runs; run++) {
    const { failed } = simulatePath(
      setup, pots0,
      () => Math.exp(muM + sigmaM * normal()),
      (year, wealth) => { samples[year][run] = wealth; },
    );
    if (!failed) successes++;
  }

  const bands = samples.map((yearSamples, i) => {
    const sorted = Array.from(yearSamples).sort((a, b) => a - b);
    return {
      age: Math.round(setup.currentAge + i),
      p10: Math.round(sorted[Math.floor(0.10 * (runs - 1))]),
      p50: Math.round(sorted[Math.floor(0.50 * (runs - 1))]),
      p90: Math.round(sorted[Math.floor(0.90 * (runs - 1))]),
    };
  });

  return { successRate: successes / runs, bands, runs };
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
