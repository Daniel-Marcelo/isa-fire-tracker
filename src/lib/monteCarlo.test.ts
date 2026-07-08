import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { mulberry32, runMonteCarlo, solveEarliestFireAge, successCurve } from './monteCarlo';
import { findFireAges } from './fireProjection';

function makeSettings(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    currentAge: 40,
    targetRetirementAge: 55,
    monthlyContribution: 1000,
    monthlyPensionContribution: 500,
    pensionAccessAge: 57,
    expectedAnnualReturn: 7,
    inflationRate: 3,
    annualExpensesInRetirement: 25000,
    withdrawalRate: 3.5,
    returnVolatility: 15,
    statePensionEnabled: false, // keep scenarios pure unless a test opts in
    ...overrides,
  };
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    seqA.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });
});

describe('runMonteCarlo', () => {
  it('is deterministic for the same seed and inputs', () => {
    const s = makeSettings();
    const a = runMonteCarlo(s, 200_000, 100_000, 50);
    const b = runMonteCarlo(s, 200_000, 100_000, 50);
    expect(a.successRate).toBe(b.successRate);
    expect(a.bands).toEqual(b.bands);
  });

  it('zero volatility yields an all-or-nothing outcome with collapsed bands', () => {
    const s = makeSettings({ returnVolatility: 0 });
    const result = runMonteCarlo(s, 500_000, 300_000, 50, { runs: 50 });
    expect(result.successRate === 0 || result.successRate === 1).toBe(true);
    for (const band of result.bands) {
      expect(band.p10).toBe(band.p50);
      expect(band.p50).toBe(band.p90);
    }
  });

  it('zero volatility with ample wealth succeeds; with absurd spending fails', () => {
    const rich = runMonteCarlo(
      makeSettings({ returnVolatility: 0 }),
      2_000_000, 1_000_000, 45,
      { runs: 20 },
    );
    expect(rich.successRate).toBe(1);

    const broke = runMonteCarlo(
      makeSettings({ returnVolatility: 0, annualExpensesInRetirement: 500_000, monthlyContribution: 0, monthlyPensionContribution: 0 }),
      100_000, 50_000, 41,
      { runs: 20 },
    );
    expect(broke.successRate).toBe(0);
  });

  it('higher volatility does not increase the success rate', () => {
    // Borderline plan so the failure tail has room to grow with volatility.
    const base = { accessible: 400_000, pension: 250_000, retireAge: 50 };
    const low = runMonteCarlo(makeSettings({ returnVolatility: 5 }), base.accessible, base.pension, base.retireAge);
    const high = runMonteCarlo(makeSettings({ returnVolatility: 30 }), base.accessible, base.pension, base.retireAge);
    expect(high.successRate).toBeLessThanOrEqual(low.successRate);
  });

  it('handles a degenerate horizon without crashing', () => {
    const s = makeSettings({ currentAge: 96 });
    const result = runMonteCarlo(s, 100_000, 0, 96);
    expect(result.bands).toEqual([]);
    expect(result.successRate).toBe(1);
  });

  it('band ages start at currentAge and are yearly', () => {
    const s = makeSettings({ currentAge: 40, returnVolatility: 10 });
    const result = runMonteCarlo(s, 100_000, 50_000, 55, { runs: 30 });
    expect(result.bands[0].age).toBe(40);
    expect(result.bands[1].age).toBe(41);
    // p10 <= p50 <= p90 at every age
    for (const b of result.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
    }
  });
});

/** Treat "not reachable" as an age above every real one so monotonicity comparisons hold. */
const ageOrInf = (a: number | null): number => a ?? Infinity;

describe('solveEarliestFireAge', () => {
  it('with σ=0 the solved age survives deterministically and one month earlier does not', () => {
    const s = makeSettings({ returnVolatility: 0, monthlyContribution: 1500 });
    const acc = 200_000, pen = 120_000;
    const solved = solveEarliestFireAge(s, acc, pen);
    expect(solved).not.toBeNull();
    // σ=0 MC with one run is the deterministic path — the survival oracle.
    const survives = (age: number) =>
      runMonteCarlo(s, acc, pen, age, { runs: 1 }).successRate === 1;
    expect(survives(solved!)).toBe(true);
    expect(survives(solved! - 1 / 12)).toBe(false);
  });

  it('σ=0 solved age matches the deterministic survival age within a month', () => {
    const s = makeSettings({ returnVolatility: 0, monthlyContribution: 1500 });
    const acc = 200_000, pen = 120_000;
    const solved = solveEarliestFireAge(s, acc, pen)!;
    const { earlyFireAge, fullFireAge } = findFireAges(s, acc, pen);
    const detAge = Math.min(ageOrInf(earlyFireAge), ageOrInf(fullFireAge));
    // findFireAges checks yearly; the solver has month resolution, so it lands at
    // or just below the whole-year survival age.
    expect(solved).toBeLessThanOrEqual(detAge + 1e-9);
    expect(solved).toBeGreaterThan(detAge - 1);
  });

  it('absurd wealth solves to currentAge; absurd spending is unreachable (null)', () => {
    const rich = solveEarliestFireAge(makeSettings({ returnVolatility: 10 }), 50_000_000, 20_000_000);
    expect(rich).toBe(40);
    const poor = solveEarliestFireAge(
      makeSettings({ annualExpensesInRetirement: 2_000_000, monthlyContribution: 0, monthlyPensionContribution: 0 }),
      10_000, 10_000,
    );
    expect(poor).toBeNull();
  });

  it('raising the target confidence never lowers the solved age', () => {
    const acc = 300_000, pen = 150_000;
    const lo = solveEarliestFireAge(makeSettings({ targetConfidence: 70 }), acc, pen);
    const hi = solveEarliestFireAge(makeSettings({ targetConfidence: 95 }), acc, pen);
    expect(ageOrInf(hi)).toBeGreaterThanOrEqual(ageOrInf(lo));
  });

  it('enabling the state pension never raises the solved age', () => {
    const acc = 300_000, pen = 150_000;
    const off = solveEarliestFireAge(makeSettings({ statePensionEnabled: false }), acc, pen);
    const on = solveEarliestFireAge(
      makeSettings({ statePensionEnabled: true, statePensionAnnual: 12000, statePensionAge: 67 }),
      acc, pen,
    );
    expect(ageOrInf(on)).toBeLessThanOrEqual(ageOrInf(off));
  });

  it('a shorter planToAge never raises the solved age', () => {
    const acc = 300_000, pen = 150_000;
    const short = solveEarliestFireAge(makeSettings({ planToAge: 85 }), acc, pen);
    const long = solveEarliestFireAge(makeSettings({ planToAge: 100 }), acc, pen);
    expect(ageOrInf(short)).toBeLessThanOrEqual(ageOrInf(long));
  });

  it('is deterministic: the same seed gives an identical solved age and curve', () => {
    const s = makeSettings({ returnVolatility: 12 });
    const acc = 300_000, pen = 150_000;
    expect(solveEarliestFireAge(s, acc, pen)).toBe(solveEarliestFireAge(s, acc, pen));
    expect(successCurve(s, acc, pen)).toEqual(successCurve(s, acc, pen));
  });
});

describe('successCurve', () => {
  it('is non-decreasing in retirement age and reported as percentages', () => {
    const s = makeSettings({ returnVolatility: 15 });
    const curve = successCurve(s, 300_000, 150_000);
    expect(curve.length).toBeGreaterThan(0);
    for (const pt of curve) {
      expect(pt.pct).toBeGreaterThanOrEqual(0);
      expect(pt.pct).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].pct).toBeGreaterThanOrEqual(curve[i - 1].pct);
      expect(curve[i].age).toBeGreaterThan(curve[i - 1].age);
    }
  });
});
