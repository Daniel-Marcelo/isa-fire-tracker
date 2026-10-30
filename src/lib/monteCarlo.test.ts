import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { mulberry32, runMonteCarlo, successCurve } from './monteCarlo';
import { potsFromAccessible } from './fireEngine';

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

  it('the median path compounds at the expected real return', () => {
    const s = makeSettings({
      monthlyContribution: 0,
      monthlyPensionContribution: 0,
      annualExpensesInRetirement: 0,
      returnVolatility: 15,
    });
    const start = 100_000;
    const years = 10;
    const result = runMonteCarlo(s, { cash: 0, isa: start, gia: 0, pension: 0 }, 40 + years, { runs: 4000, endAge: 40 + years });
    const real = 1.07 / 1.03 - 1;
    const median = result.bands[result.bands.length - 1].p50;
    expect(median).toBeGreaterThan(start * (1 + real) ** years * 0.95);
    expect(median).toBeLessThan(start * (1 + real) ** years * 1.05);
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

  it('is deterministic for the same seed', () => {
    const s = makeSettings({ returnVolatility: 12 });
    const pots = potsFromAccessible(300_000, 150_000);
    expect(successCurve(s, pots)).toEqual(successCurve(s, pots));
  });
});

describe('runMonteCarlo output pin', () => {
  it('matches the recorded output for a mixed-pot plan', () => {
    const s = makeSettings({ statePensionEnabled: true, cashAnnualReturn: 4, pensionTaxRate: 20, giaCgtRate: 10 });
    const r = runMonteCarlo(s, { cash: 20_000, isa: 150_000, gia: 30_000, pension: 120_000 }, 52, { runs: 200 });
    expect(r).toMatchSnapshot();
  });
});
