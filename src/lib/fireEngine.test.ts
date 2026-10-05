import { describe, it, expect } from 'vitest';
import type { FireSettings, Provider } from '../types';
import {
  drawdownParamsFrom,
  monthlyWithdrawals,
  planToAgeOf,
  potsFromAccessible,
  potsFromProviders,
  targetConfidenceOf,
  type DrawdownParams,
} from './fireEngine';

function makeParams(overrides: Partial<DrawdownParams> = {}): DrawdownParams {
  return {
    pensionAccessAge: 57,
    monthlySpend: 1000,
    statePensionMonthly: 0,
    statePensionAge: 67,
    pensionTaxRate: 0,
    giaCgtRate: 0,
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
  it('bridge months draw cash → ISA → GIA and nothing from pension, even at 99% tax', () => {
    const p = makeParams({ pensionTaxRate: 0.99 });
    const pots = potsFromAccessible(100_000, 500_000);
    const w = monthlyWithdrawals(50, pots, p);
    expect(w.fromIsa).toBe(1000);
    expect(w.fromCash).toBe(0);
    expect(w.fromGia).toBe(0);
    expect(w.fromPension).toBe(0);
    expect(w.unmetNeed).toBe(0);
  });

  it('draws cash before ISA before GIA', () => {
    const p = makeParams({ monthlySpend: 3000 });
    const w = monthlyWithdrawals(50, { cash: 1000, isa: 1000, gia: 5000, pension: 0 }, p);
    expect(w.fromCash).toBe(1000);
    expect(w.fromIsa).toBe(1000);
    expect(w.fromGia).toBe(1000); // remaining need, CGT = 0
    expect(w.fromPension).toBe(0);
  });

  it('grosses up GIA withdrawals for CGT: £1,000 net at 20% → £1,250 from the pot', () => {
    const p = makeParams({ giaCgtRate: 0.2 });
    const w = monthlyWithdrawals(50, { cash: 0, isa: 0, gia: 400_000, pension: 0 }, p);
    expect(w.fromGia).toBeCloseTo(1250, 8);
    expect(w.unmetNeed).toBe(0);
  });

  it('post-access with everything in the pension grosses up for tax: £1,000 net at 20% → £1,250 gross', () => {
    const p = makeParams({ pensionTaxRate: 0.2 });
    const w = monthlyWithdrawals(60, { cash: 0, isa: 0, gia: 0, pension: 400_000 }, p);
    expect(w.fromIsa).toBe(0);
    expect(w.fromPension).toBeCloseTo(1250, 8);
    expect(w.unmetNeed).toBe(0);
  });

  it('post-access prefers taxable wrappers before tapping the pension', () => {
    // £750 of need covered by ISA (tax-free); remaining £250 from pension at 20% → £312.50
    const p = makeParams({ pensionTaxRate: 0.2, monthlySpend: 1000 });
    const w = monthlyWithdrawals(60, { cash: 0, isa: 750, gia: 0, pension: 100_000 }, p);
    expect(w.fromIsa).toBe(750);
    expect(w.fromPension).toBeCloseTo(250 / 0.8, 8);
  });

  it('bridge shortfall leaves unmetNeed when accessible pots are empty', () => {
    const p = makeParams({ monthlySpend: 2000 });
    const w = monthlyWithdrawals(50, { cash: 500, isa: 500, gia: 0, pension: 1_000_000 }, p);
    expect(w.fromCash).toBe(500);
    expect(w.fromIsa).toBe(500);
    expect(w.fromPension).toBe(0);
    expect(w.unmetNeed).toBe(1000);
  });

  it('state pension covering all of spending zeroes both withdrawals', () => {
    const p = makeParams({ statePensionMonthly: 1200 });
    const w = monthlyWithdrawals(70, potsFromAccessible(100_000, 100_000), p);
    expect(w.fromIsa).toBe(0);
    expect(w.fromPension).toBe(0);
  });

  it('state pension only applies from statePensionAge', () => {
    const p = makeParams({ statePensionMonthly: 600 });
    const before = monthlyWithdrawals(66, potsFromAccessible(100_000, 0), p);
    const after = monthlyWithdrawals(67, potsFromAccessible(100_000, 0), p);
    expect(before.fromIsa + before.fromPension).toBeCloseTo(1000, 8);
    expect(after.fromIsa + after.fromPension).toBeCloseTo(400, 8);
  });
});

describe('potsFromProviders', () => {
  it('buckets by account type', () => {
    const providers: Provider[] = [
      { id: '1', name: 'Cash', color: '#000', accountType: 'Cash ISA', holdings: [{ id: 'a', name: 'Cash', manualValue: 10_000, currentValue: 10_000 }], snapshots: [] },
      { id: '2', name: 'ISA', color: '#000', accountType: 'ISA', holdings: [{ id: 'b', name: 'VWRL', units: 1, currentValue: 50_000 }], snapshots: [] },
      { id: '3', name: 'GIA', color: '#000', accountType: 'GIA', holdings: [{ id: 'c', name: 'VUAG', units: 1, currentValue: 20_000 }], snapshots: [] },
      { id: '4', name: 'SIPP', color: '#000', accountType: 'SIPP', holdings: [{ id: 'd', name: 'VWRP', units: 1, currentValue: 80_000 }], snapshots: [] },
    ];
    expect(potsFromProviders(providers)).toEqual({
      cash: 10_000,
      isa: 50_000,
      gia: 20_000,
      pension: 80_000,
    });
  });
});

describe('drawdownParamsFrom', () => {
  it('applies defaults: state pension on at £12,000 from 67, 15% pension tax, 10% GIA CGT', () => {
    const p = drawdownParamsFrom(makeSettings());
    expect(p.statePensionMonthly).toBe(1000);
    expect(p.statePensionAge).toBe(67);
    expect(p.pensionTaxRate).toBeCloseTo(0.15, 10);
    expect(p.giaCgtRate).toBeCloseTo(0.10, 10);
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

  it('clamps GIA CGT into [0, 0.4]', () => {
    expect(drawdownParamsFrom(makeSettings({ giaCgtRate: 80 })).giaCgtRate).toBe(0.4);
    expect(drawdownParamsFrom(makeSettings({ giaCgtRate: -1 })).giaCgtRate).toBe(0);
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
