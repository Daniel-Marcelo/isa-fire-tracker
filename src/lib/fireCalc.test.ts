import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { runFireCalc, MC_RUNS, type FireCalcRequest } from './fireCalc';
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

describe('runFireCalc', () => {
  it('stress-tests the given retirement age', () => {
    const req: FireCalcRequest = { id: 1, settings: makeSettings(), pots: potsFromAccessible(300_000, 150_000), retireAge: 52 };
    const result = runFireCalc(req);
    expect(result.id).toBe(1);
    expect(result.mc!.runs).toBe(MC_RUNS);
    expect(result.backtest!.cycles).toBe(HISTORICAL_REAL_RETURNS.length);
    expect(result.curve.length).toBeGreaterThan(0);
    expect(result.sensitivity).not.toBeNull();
  });

  it('retiring a year later never scores lower than the headline', () => {
    const result = runFireCalc({ id: 2, settings: makeSettings(), pots: potsFromAccessible(300_000, 150_000), retireAge: 52 });
    expect(result.sensitivity!.later).toBeGreaterThanOrEqual(result.mc!.successRate);
  });

  it('with no retirement age, still returns the curve but nothing to test', () => {
    const result = runFireCalc({ id: 3, settings: makeSettings(), pots: potsFromAccessible(300_000, 150_000), retireAge: null });
    expect(result.mc).toBeNull();
    expect(result.backtest).toBeNull();
    expect(result.sensitivity).toBeNull();
    expect(result.curve.length).toBeGreaterThan(0);
  });

  it('handles a degenerate horizon without throwing', () => {
    const result = runFireCalc({
      id: 4,
      settings: makeSettings({ currentAge: 96, planToAge: 96 }),
      pots: potsFromAccessible(300_000, 150_000),
      retireAge: 96,
    });
    expect(result.mc).toBeNull();
    expect(result.backtest).toBeNull();
    expect(result.curve).toEqual([]);
    expect(result.sensitivity).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const req: FireCalcRequest = { id: 5, settings: makeSettings({ returnVolatility: 12 }), pots: potsFromAccessible(250_000, 120_000), retireAge: 50 };
    expect(runFireCalc(req)).toEqual(runFireCalc(req));
  });
});
