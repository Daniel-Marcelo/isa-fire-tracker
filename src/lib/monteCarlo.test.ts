import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { mulberry32, runMonteCarlo, solveEarliestFireAge, solveRequiredContribution, successCurve } from './monteCarlo';
import { findFireAges } from './fireProjection';
import { potsFromAccessible, targetConfidenceOf } from './fireEngine';

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
    const pots = potsFromAccessible(200_000, 100_000);
    const a = runMonteCarlo(s, pots, 50);
    const b = runMonteCarlo(s, pots, 50);
    expect(a.successRate).toBe(b.successRate);
    expect(a.bands).toEqual(b.bands);
  });

  it('zero volatility yields an all-or-nothing outcome with collapsed bands', () => {
    const s = makeSettings({ returnVolatility: 0 });
    const result = runMonteCarlo(s, potsFromAccessible(500_000, 300_000), 50, { runs: 50 });
    expect(result.successRate === 0 || result.successRate === 1).toBe(true);
    for (const band of result.bands) {
      expect(band.p10).toBe(band.p50);
      expect(band.p50).toBe(band.p90);
    }
  });

  it('zero volatility with ample wealth succeeds; with absurd spending fails', () => {
    const rich = runMonteCarlo(
      makeSettings({ returnVolatility: 0 }),
      potsFromAccessible(2_000_000, 1_000_000), 45,
      { runs: 20 },
    );
    expect(rich.successRate).toBe(1);

    const broke = runMonteCarlo(
      makeSettings({ returnVolatility: 0, annualExpensesInRetirement: 500_000, monthlyContribution: 0, monthlyPensionContribution: 0 }),
      potsFromAccessible(100_000, 50_000), 41,
      { runs: 20 },
    );
    expect(broke.successRate).toBe(0);
  });

  it('higher volatility does not increase the success rate', () => {
    // Borderline plan so the failure tail has room to grow with volatility.
    const pots = potsFromAccessible(400_000, 250_000);
    const low = runMonteCarlo(makeSettings({ returnVolatility: 5 }), pots, 50);
    const high = runMonteCarlo(makeSettings({ returnVolatility: 30 }), pots, 50);
    expect(high.successRate).toBeLessThanOrEqual(low.successRate);
  });

  it('cash compounds at its own rate, not the equity return', () => {
    const s = makeSettings({
      returnVolatility: 0,
      expectedAnnualReturn: 10,
      cashAnnualReturn: 0,
      inflationRate: 0,
      monthlyContribution: 0,
      monthlyPensionContribution: 0,
      // Tiny spend so neither path fails — we only care about terminal wealth.
      annualExpensesInRetirement: 12,
    });
    const cash = runMonteCarlo(s, { cash: 100_000, isa: 0, gia: 0, pension: 0 }, 90, { runs: 1 });
    const isa = runMonteCarlo(s, { cash: 0, isa: 100_000, gia: 0, pension: 0 }, 90, { runs: 1 });
    const cashEnd = cash.bands[cash.bands.length - 1].p50;
    const isaEnd = isa.bands[isa.bands.length - 1].p50;
    expect(isaEnd).toBeGreaterThan(cashEnd);
  });

  it('handles a degenerate horizon without crashing', () => {
    const s = makeSettings({ currentAge: 96 });
    const result = runMonteCarlo(s, potsFromAccessible(100_000, 0), 96);
    expect(result.bands).toEqual([]);
    expect(result.successRate).toBe(1);
  });

  it('band ages start at currentAge and are yearly', () => {
    const s = makeSettings({ currentAge: 40, returnVolatility: 10 });
    const result = runMonteCarlo(s, potsFromAccessible(100_000, 50_000), 55, { runs: 30 });
    expect(result.bands[0].age).toBe(40);
    expect(result.bands[1].age).toBe(41);
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
    const pots = potsFromAccessible(200_000, 120_000);
    const solved = solveEarliestFireAge(s, pots);
    expect(solved).not.toBeNull();
    const survives = (age: number) =>
      runMonteCarlo(s, pots, age, { runs: 1 }).successRate === 1;
    expect(survives(solved!)).toBe(true);
    expect(survives(solved! - 1 / 12)).toBe(false);
  });

  it('σ=0 solved age matches the deterministic survival age within a month', () => {
    const s = makeSettings({ returnVolatility: 0, monthlyContribution: 1500 });
    const pots = potsFromAccessible(200_000, 120_000);
    const solved = solveEarliestFireAge(s, pots)!;
    const { earlyFireAge, fullFireAge } = findFireAges(s, pots);
    const detAge = Math.min(ageOrInf(earlyFireAge), ageOrInf(fullFireAge));
    expect(solved).toBeLessThanOrEqual(detAge + 1e-9);
    expect(solved).toBeGreaterThan(detAge - 1);
  });

  it('absurd wealth solves to currentAge; absurd spending is unreachable (null)', () => {
    const rich = solveEarliestFireAge(makeSettings({ returnVolatility: 10 }), potsFromAccessible(50_000_000, 20_000_000));
    expect(rich).toBe(40);
    const poor = solveEarliestFireAge(
      makeSettings({ annualExpensesInRetirement: 2_000_000, monthlyContribution: 0, monthlyPensionContribution: 0 }),
      potsFromAccessible(10_000, 10_000),
    );
    expect(poor).toBeNull();
  });

  it('raising the target confidence never lowers the solved age', () => {
    const pots = potsFromAccessible(300_000, 150_000);
    const lo = solveEarliestFireAge(makeSettings({ targetConfidence: 70 }), pots);
    const hi = solveEarliestFireAge(makeSettings({ targetConfidence: 95 }), pots);
    expect(ageOrInf(hi)).toBeGreaterThanOrEqual(ageOrInf(lo));
  });

  it('enabling the state pension never raises the solved age', () => {
    const pots = potsFromAccessible(300_000, 150_000);
    const off = solveEarliestFireAge(makeSettings({ statePensionEnabled: false }), pots);
    const on = solveEarliestFireAge(
      makeSettings({ statePensionEnabled: true, statePensionAnnual: 12000, statePensionAge: 67 }),
      pots,
    );
    expect(ageOrInf(on)).toBeLessThanOrEqual(ageOrInf(off));
  });

  it('a shorter planToAge never raises the solved age', () => {
    const pots = potsFromAccessible(300_000, 150_000);
    const short = solveEarliestFireAge(makeSettings({ planToAge: 85 }), pots);
    const long = solveEarliestFireAge(makeSettings({ planToAge: 100 }), pots);
    expect(ageOrInf(short)).toBeLessThanOrEqual(ageOrInf(long));
  });

  it('is deterministic: the same seed gives an identical solved age and curve', () => {
    const s = makeSettings({ returnVolatility: 12 });
    const pots = potsFromAccessible(300_000, 150_000);
    expect(solveEarliestFireAge(s, pots)).toBe(solveEarliestFireAge(s, pots));
    expect(successCurve(s, pots)).toEqual(successCurve(s, pots));
  }, 30_000);
});

describe('solveRequiredContribution', () => {
  it('returns 0 when ample pots already clear the target with modest spending', () => {
    const s = makeSettings({ monthlyContribution: 500, monthlyPensionContribution: 200 });
    const result = solveRequiredContribution(s, potsFromAccessible(2_000_000, 1_000_000), 50);
    expect(result).toBe(0);
  });

  it('returns null when unreachable at any saving rate: a structural bridge failure', () => {
    // All new money is routed to pension (isaShare = 0) but retirement happens
    // well before pensionAccessAge, and the ISA/cash/GIA pots start at 0.
    const s = makeSettings({
      currentAge: 40,
      monthlyContribution: 0,
      monthlyPensionContribution: 500,
      pensionAccessAge: 57,
    });
    const result = solveRequiredContribution(s, potsFromAccessible(0, 0), 45);
    expect(result).toBeNull();
  });

  it('returns null for a zero-length or negative accumulation window', () => {
    const s = makeSettings({ currentAge: 40 });
    const pots = potsFromAccessible(300_000, 150_000);
    expect(solveRequiredContribution(s, pots, 40)).toBeNull();
    expect(solveRequiredContribution(s, pots, 38)).toBeNull();
  });

  it('the solved contribution meets the target; £20/mo less misses it', () => {
    const s = makeSettings({ monthlyContribution: 600, monthlyPensionContribution: 300 });
    const pots = potsFromAccessible(150_000, 80_000);
    const retireAge = 50;
    const solved = solveRequiredContribution(s, pots, retireAge);
    expect(solved).not.toBeNull();

    const target = targetConfidenceOf(s) / 100;
    const base = s.monthlyContribution + (s.monthlyPensionContribution ?? 0);
    const isaShare = base > 0 ? s.monthlyContribution / base : 1;
    const rateAt = (total: number) => runMonteCarlo(
      { ...s, monthlyContribution: total * isaShare, monthlyPensionContribution: total * (1 - isaShare) },
      pots, retireAge,
    ).successRate;

    expect(rateAt(solved!)).toBeGreaterThanOrEqual(target);
    expect(rateAt(solved! - 20)).toBeLessThan(target);
  });

  it('preserves the current ISA:pension contribution ratio', () => {
    const pots = potsFromAccessible(150_000, 50_000);
    const retireAge = 48;
    const isaHeavy = makeSettings({ monthlyContribution: 800, monthlyPensionContribution: 400 });
    const penHeavy = makeSettings({ monthlyContribution: 400, monthlyPensionContribution: 800 });
    const solvedIsaHeavy = solveRequiredContribution(isaHeavy, pots, retireAge);
    const solvedPenHeavy = solveRequiredContribution(penHeavy, pots, retireAge);
    if (solvedIsaHeavy != null && solvedPenHeavy != null) {
      expect(solvedIsaHeavy).toBeLessThanOrEqual(solvedPenHeavy);
    }
  });

  it('is deterministic: the same inputs give an identical solved contribution', () => {
    const s = makeSettings({ returnVolatility: 12 });
    const pots = potsFromAccessible(300_000, 150_000);
    expect(solveRequiredContribution(s, pots, 50)).toBe(solveRequiredContribution(s, pots, 50));
  });
});

describe('successCurve', () => {
  it('is non-decreasing in retirement age and reported as percentages', () => {
    const s = makeSettings({ returnVolatility: 15 });
    const curve = successCurve(s, potsFromAccessible(300_000, 150_000));
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
