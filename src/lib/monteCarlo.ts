import type { FireSettings } from '../types';

export interface MonteCarloResult {
  /** Fraction of simulated paths (0..1) where money lasted to endAge. */
  successRate: number;
  /** Combined wealth percentiles sampled yearly. Empty when the horizon is degenerate. */
  bands: { age: number; p10: number; p50: number; p90: number }[];
  runs: number;
}

export interface MonteCarloOptions {
  runs: number;
  endAge: number;
  seed: number;
}

export const DEFAULT_MC_OPTIONS: MonteCarloOptions = { runs: 1000, endAge: 95, seed: 12345 };

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
 * rules as the deterministic projection in fireProjection.ts, retiring every path
 * at the deterministic FIRE age. A path fails if the accessible pot is exhausted
 * before pension access, or the combined pot is exhausted before endAge.
 */
export function runMonteCarlo(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
  retireAge: number,
  opts: MonteCarloOptions = DEFAULT_MC_OPTIONS,
): MonteCarloResult {
  const { runs, endAge, seed } = opts;
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate, annualExpensesInRetirement } = settings;

  const realAnnual = (1 + expectedAnnualReturn / 100) / (1 + inflationRate / 100) - 1;
  const sigmaA = Math.max(settings.returnVolatility ?? 15, 0) / 100;
  const sigmaM = sigmaA / Math.sqrt(12);
  // Median-preserving drift with the lognormal -σ²/2 correction; at σ=0 this is
  // exactly the deterministic monthly growth factor.
  const muM = Math.log(1 + realAnnual) / 12 - (sigmaM * sigmaM) / 2;
  const monthlyPension = monthlyPensionContribution ?? 0;
  const monthlySpend = annualExpensesInRetirement / 12;

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
      const retired = age >= retireAge;
      const pensionUnlocked = age >= pensionAccessAge;

      if (!retired) {
        accessible = accessible * growth + monthlyContribution;
        pension = pension * growth + monthlyPension;
      } else if (!pensionUnlocked) {
        accessible = accessible * growth - monthlySpend;
        pension = pension * growth;
        if (!failed && accessible < 0) {
          failed = true;
          accessible = 0; // keep simulating for the bands, but the path has failed
        }
      } else {
        const total = Math.max(accessible + pension, 0);
        const accRatio = total > 0 ? Math.max(accessible, 0) / total : 0;
        accessible = accessible * growth - monthlySpend * accRatio;
        pension = pension * growth - monthlySpend * (1 - accRatio);
        if (!failed && accessible + pension < 0) failed = true;
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
