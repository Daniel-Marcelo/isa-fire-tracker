import { describe, it, expect } from 'vitest';
import { realMonthlyRate, findFireAges, project } from './fireProjection';
import type { FireSettings } from '../types';

function makeSettings(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    currentAge: 30,
    targetRetirementAge: 55,
    currentSavings: 0,
    monthlyContribution: 0,
    monthlyPensionContribution: 0,
    pensionAccessAge: 57,
    expectedAnnualReturn: 7,
    inflationRate: 3,
    annualExpensesInRetirement: 25000,
    withdrawalRate: 3.5,
    ...overrides,
  };
}

describe('realMonthlyRate', () => {
  it('matches the real-return compounding formula', () => {
    const expected = Math.pow(1.07 / 1.03, 1 / 12) - 1;
    expect(realMonthlyRate(7, 3)).toBeCloseTo(expected, 10);
  });
});

describe('findFireAges', () => {
  it('returns both ages null with zero contributions, zero savings, nonzero expenses', () => {
    const settings = makeSettings({ monthlyContribution: 0, monthlyPensionContribution: 0 });
    const { earlyFireAge, fullFireAge } = findFireAges(settings, 0, 0);
    expect(earlyFireAge).toBeNull();
    expect(fullFireAge).toBeNull();
  });

  it('gives immediate earlyFireAge when the accessible pot is huge (10x the SWR target)', () => {
    const settings = makeSettings({ currentAge: 30, pensionAccessAge: 57 });
    const swrTarget = settings.annualExpensesInRetirement / ((settings.withdrawalRate ?? 3.5) / 100);
    const { earlyFireAge } = findFireAges(settings, swrTarget * 10, 0);
    expect(earlyFireAge).toBe(30);
  });

  it('with the pot exactly at target but all in pension: no bridge (earlyFireAge null), fullFireAge = pension access age', () => {
    const settings = makeSettings({ currentAge: 30, pensionAccessAge: 57 });
    const swrTarget = settings.annualExpensesInRetirement / ((settings.withdrawalRate ?? 3.5) / 100);
    const { earlyFireAge, fullFireAge } = findFireAges(settings, 0, swrTarget);
    expect(earlyFireAge).toBeNull();
    expect(fullFireAge).toBe(57);
  });
});

describe('project', () => {
  const settings = makeSettings({ currentAge: 30, monthlyContribution: 1000 });
  const result = project(settings, 0, 0);

  it('starts at the current age and produces yearly points (~51 entries, m 0..600 step 12)', () => {
    expect(result.points[0].age).toBe(30);
    expect(result.points).toHaveLength(51);
  });

  it('has monotonically increasing ages', () => {
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].age).toBeGreaterThan(result.points[i - 1].age);
    }
  });

  it('never has negative balances in the output', () => {
    for (const pt of result.points) {
      expect(pt.accessible).toBeGreaterThanOrEqual(0);
      expect(pt.pension).toBeGreaterThanOrEqual(0);
      expect(pt.combined).toBeGreaterThanOrEqual(0);
    }
  });
});
