import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { formatYearRanges, monthlyGrowthFactors, runBacktest } from './historicalBacktest';
import { runMonteCarlo } from './monteCarlo';
import { potsFromAccessible } from './fireEngine';
import { HISTORICAL_REAL_RETURNS } from './historicalReturns';

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
    statePensionEnabled: false,
    ...overrides,
  };
}

const flat = [2000, 2001, 2002].map(year => ({ year, real: 0.05 }));

describe('monthlyGrowthFactors', () => {
  it('compounds at the expected real return across a full cycle', () => {
    const real = 0.04;
    const series = [{ year: 2000, real: -0.2 }, { year: 2001, real: 0.5 }, { year: 2002, real: 0 }];
    const monthly = monthlyGrowthFactors(real, series);
    const annual = series.map((_, i) => monthly[i] ** 12);
    const compound = Math.exp(annual.reduce((s, f) => s + Math.log(f), 0) / annual.length);
    expect(compound).toBeCloseTo(1 + real, 10);
  });
});

describe('runBacktest', () => {
  it('a flat history is the steady-return plan: matches σ=0 Monte Carlo', () => {
    const s = makeSettings();
    const rich = potsFromAccessible(2_000_000, 1_000_000);
    const poor = potsFromAccessible(10_000, 0);
    const sigma0 = { ...s, returnVolatility: 0 };
    expect(runBacktest(s, rich, 45, { returns: flat }).successRate)
      .toBe(runMonteCarlo(sigma0, rich, 45, { runs: 1 }).successRate);
    expect(runBacktest(s, poor, 41, { returns: flat }).successRate)
      .toBe(runMonteCarlo(sigma0, poor, 41, { runs: 1 }).successRate);
  });

  it('runs one cycle per start year and lists failures in order', () => {
    const r = runBacktest(makeSettings(), potsFromAccessible(300_000, 150_000), 50);
    expect(r.cycles).toBe(HISTORICAL_REAL_RETURNS.length);
    expect(r.firstYear).toBe(HISTORICAL_REAL_RETURNS[0].year);
    expect(r.lastYear).toBe(HISTORICAL_REAL_RETURNS.at(-1)!.year);
    expect(r.successRate).toBeCloseTo(1 - r.failedStartYears.length / r.cycles, 12);
    for (let i = 1; i < r.failedStartYears.length; i++) {
      expect(r.failedStartYears[i]).toBeGreaterThan(r.failedStartYears[i - 1]);
    }
  });

  it('sequence risk: a crash at the start of retirement fails where a crash at the end does not', () => {
    // Mean-zero series: start 2000 retires into the crash, start 2001 retires into the boom.
    const swing = [{ year: 2000, real: -0.3 }, { year: 2001, real: 0.3 }];
    const s = makeSettings({
      currentAge: 60, planToAge: 82,
      expectedAnnualReturn: 8, inflationRate: 3,
      monthlyContribution: 0, monthlyPensionContribution: 0,
      annualExpensesInRetirement: 45_000,
    });
    const r = runBacktest(s, potsFromAccessible(600_000, 0), 60, { returns: swing });
    expect(r.failedStartYears).toContain(2000);
    expect(r.failedStartYears).not.toContain(2001);
  });

  it('a degenerate horizon reports no cycles and success', () => {
    const r = runBacktest(makeSettings({ currentAge: 96 }), potsFromAccessible(100_000, 0), 96);
    expect(r).toEqual({ successRate: 1, cycles: 0, failedStartYears: [], firstYear: null, lastYear: null });
  });

  it('is deterministic', () => {
    const s = makeSettings();
    const pots = potsFromAccessible(300_000, 150_000);
    expect(runBacktest(s, pots, 50)).toEqual(runBacktest(s, pots, 50));
  });
});

describe('formatYearRanges', () => {
  it('collapses consecutive years', () => {
    expect(formatYearRanges([])).toBe('');
    expect(formatYearRanges([1929])).toBe('1929');
    expect(formatYearRanges([1906, 1929, 1930, 1931, 1966])).toBe('1906, 1929–1931, 1966');
  });
});
