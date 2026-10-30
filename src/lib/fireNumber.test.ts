import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { fireNumberOf } from './fireNumber';
import { emptyPots } from './fireEngine';

function makeSettings(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    currentAge: 40,
    targetRetirementAge: 55,
    monthlyContribution: 0,
    monthlyPensionContribution: 0,
    pensionAccessAge: 57,
    expectedAnnualReturn: 7,
    inflationRate: 3,
    annualExpensesInRetirement: 25000,
    withdrawalRate: 4,
    statePensionEnabled: false,
    ...overrides,
  };
}

describe('fireNumberOf', () => {
  it('is spending divided by the withdrawal rate: 25x at 4%', () => {
    const n = fireNumberOf(makeSettings(), emptyPots());
    expect(n.withdrawalRate).toBeCloseTo(0.04, 10);
    expect(n.target).toBeCloseTo(625_000, 6);
  });

  it('uses 3.5% as about 28.6x', () => {
    const n = fireNumberOf(makeSettings({ withdrawalRate: 3.5 }), emptyPots());
    expect(n.target).toBeCloseTo(25_000 / 0.035, 6);
  });

  it('reports the smaller target once the state pension starts', () => {
    const n = fireNumberOf(
      makeSettings({ statePensionEnabled: true, statePensionAnnual: 12_000, statePensionAge: 67 }),
      emptyPots(),
    );
    expect(n.target).toBeCloseTo(625_000, 6);
    expect(n.targetWithStatePension).toBeCloseTo(13_000 / 0.04, 6);
    expect(n.statePensionAge).toBe(67);
  });

  it('with the state pension off, both targets match and there is no state pension age', () => {
    const n = fireNumberOf(makeSettings(), emptyPots());
    expect(n.targetWithStatePension).toBe(n.target);
    expect(n.statePensionAge).toBeNull();
  });

  it('a state pension above spending needs no portfolio after it starts', () => {
    const n = fireNumberOf(
      makeSettings({ annualExpensesInRetirement: 10_000, statePensionEnabled: true, statePensionAnnual: 12_000 }),
      emptyPots(),
    );
    expect(n.targetWithStatePension).toBe(0);
  });

  it('reports invested, accessible, pension, safe income and progress', () => {
    const n = fireNumberOf(makeSettings(), { cash: 10_000, isa: 200_000, gia: 40_000, pension: 100_000 });
    expect(n.invested).toBe(350_000);
    expect(n.accessible).toBe(250_000);
    expect(n.pension).toBe(100_000);
    expect(n.safeIncomeToday).toBeCloseTo(14_000, 6);
    expect(n.progress).toBeCloseTo(0.56, 10);
  });

  it('zero spending is already there', () => {
    const n = fireNumberOf(makeSettings({ annualExpensesInRetirement: 0 }), emptyPots());
    expect(n.target).toBe(0);
    expect(n.progress).toBe(1);
  });

  it('a cleared withdrawal rate field cannot divide by zero', () => {
    const n = fireNumberOf(makeSettings({ withdrawalRate: 0 }), emptyPots());
    expect(n.target).toBeCloseTo(25_000 / 0.02, 6);
  });
});
