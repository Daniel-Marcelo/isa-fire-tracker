import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { drawdownParamsFrom, monthlyWithdrawals, planToAgeOf, targetConfidenceOf, type DrawdownParams } from './fireEngine';

function makeParams(overrides: Partial<DrawdownParams> = {}): DrawdownParams {
  return {
    pensionAccessAge: 57,
    monthlySpend: 1000,
    statePensionMonthly: 0,
    statePensionAge: 67,
    pensionTaxRate: 0,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    currentAge: 30,
    targetRetirementAge: 55,
    monthlyContribution: 0,
    monthlyPensionContribution: 0,
    pensionAccessAge: 57,
    expectedAnnualReturn: 7,
    inflationRate: 3,
    annualExpensesInRetirement: 12000,
    withdrawalRate: 3.5,
    ...overrides,
  };
}

describe('monthlyWithdrawals', () => {
  it('bridge months draw everything from accessible and nothing from pension, even at 99% tax', () => {
    const p = makeParams({ pensionTaxRate: 0.99 });
    const w = monthlyWithdrawals(50, 100_000, 500_000, p);
    expect(w.fromAccessible).toBe(1000);
    expect(w.fromPension).toBe(0);
  });

  it('post-access with everything in the pension grosses up for tax: £1,000 net at 20% → £1,250 gross', () => {
    const p = makeParams({ pensionTaxRate: 0.2 });
    const w = monthlyWithdrawals(60, 0, 400_000, p);
    expect(w.fromAccessible).toBe(0);
    expect(w.fromPension).toBeCloseTo(1250, 8);
  });

  it('post-access splits pro-rata by pot size and only grosses up the pension share', () => {
    const p = makeParams({ pensionTaxRate: 0.2 });
    const w = monthlyWithdrawals(60, 300_000, 100_000, p);
    expect(w.fromAccessible).toBeCloseTo(750, 8);
    expect(w.fromPension).toBeCloseTo(250 / 0.8, 8);
  });

  it('state pension covering all of spending zeroes both withdrawals', () => {
    const p = makeParams({ statePensionMonthly: 1200 });
    const w = monthlyWithdrawals(70, 100_000, 100_000, p);
    expect(w.fromAccessible).toBe(0);
    expect(w.fromPension).toBe(0);
  });

  it('state pension only applies from statePensionAge', () => {
    const p = makeParams({ statePensionMonthly: 600 });
    const before = monthlyWithdrawals(66, 100_000, 0, p);
    const after = monthlyWithdrawals(67, 100_000, 0, p);
    expect(before.fromAccessible + before.fromPension).toBeCloseTo(1000, 8);
    expect(after.fromAccessible + after.fromPension).toBeCloseTo(400, 8);
  });
});

describe('drawdownParamsFrom', () => {
  it('applies defaults: state pension on at £12,000 from 67, 15% pension tax', () => {
    const p = drawdownParamsFrom(makeSettings());
    expect(p.statePensionMonthly).toBe(1000);
    expect(p.statePensionAge).toBe(67);
    expect(p.pensionTaxRate).toBeCloseTo(0.15, 10);
    expect(p.monthlySpend).toBe(1000);
  });

  it('disabled state pension zeroes the monthly amount', () => {
    const p = drawdownParamsFrom(makeSettings({ statePensionEnabled: false, statePensionAnnual: 12000 }));
    expect(p.statePensionMonthly).toBe(0);
  });

  it('clamps pension tax into [0, 0.6] so a typed 100% cannot divide-by-zero', () => {
    expect(drawdownParamsFrom(makeSettings({ pensionTaxRate: 100 })).pensionTaxRate).toBe(0.6);
    expect(drawdownParamsFrom(makeSettings({ pensionTaxRate: -5 })).pensionTaxRate).toBe(0);
  });
});

describe('clamped settings accessors', () => {
  it('planToAgeOf clamps into [80, 105] and defaults to 95', () => {
    expect(planToAgeOf(makeSettings())).toBe(95);
    expect(planToAgeOf(makeSettings({ planToAge: 0 }))).toBe(80); // cleared NumberInput emits 0
    expect(planToAgeOf(makeSettings({ planToAge: 200 }))).toBe(105);
  });

  it('targetConfidenceOf clamps into [50, 99] and defaults to 90', () => {
    expect(targetConfidenceOf(makeSettings())).toBe(90);
    expect(targetConfidenceOf(makeSettings({ targetConfidence: 0 }))).toBe(50);
    expect(targetConfidenceOf(makeSettings({ targetConfidence: 100 }))).toBe(99);
  });
});
