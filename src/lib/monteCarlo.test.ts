import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { mulberry32, runMonteCarlo, DEFAULT_MC_OPTIONS } from './monteCarlo';

function makeSettings(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    currentAge: 40,
    targetRetirementAge: 55,
    currentSavings: 0,
    monthlyContribution: 1000,
    monthlyPensionContribution: 500,
    pensionAccessAge: 57,
    expectedAnnualReturn: 7,
    inflationRate: 3,
    annualExpensesInRetirement: 25000,
    withdrawalRate: 3.5,
    returnVolatility: 15,
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
    const result = runMonteCarlo(s, 500_000, 300_000, 50, { ...DEFAULT_MC_OPTIONS, runs: 50 });
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
      { ...DEFAULT_MC_OPTIONS, runs: 20 },
    );
    expect(rich.successRate).toBe(1);

    const broke = runMonteCarlo(
      makeSettings({ returnVolatility: 0, annualExpensesInRetirement: 500_000, monthlyContribution: 0, monthlyPensionContribution: 0 }),
      100_000, 50_000, 41,
      { ...DEFAULT_MC_OPTIONS, runs: 20 },
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
    const result = runMonteCarlo(s, 100_000, 50_000, 55, { ...DEFAULT_MC_OPTIONS, runs: 30 });
    expect(result.bands[0].age).toBe(40);
    expect(result.bands[1].age).toBe(41);
    // p10 <= p50 <= p90 at every age
    for (const b of result.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
    }
  });
});
