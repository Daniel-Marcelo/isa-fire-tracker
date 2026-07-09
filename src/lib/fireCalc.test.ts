import { describe, it, expect } from 'vitest';
import type { FireSettings } from '../types';
import { runFireCalc, MC_RUNS, type FireCalcRequest } from './fireCalc';

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
  it('returns a well-formed result for a realistic request', () => {
    const req: FireCalcRequest = {
      id: 1,
      settings: makeSettings(),
      accessible: 300_000,
      pension: 150_000,
    };
    const result = runFireCalc(req);
    expect(result.id).toBe(1);
    expect(typeof result.headlineAge).toBe('number');
    expect(result.mc).not.toBeNull();
    expect(result.mc!.runs).toBe(MC_RUNS);
    expect(result.curve.length).toBeGreaterThan(0);
  });

  it('handles a degenerate horizon without throwing, returning nulls/empty', () => {
    const req: FireCalcRequest = {
      id: 2,
      // planToAge <= currentAge + 1 makes the horizon degenerate.
      settings: makeSettings({ currentAge: 96, planToAge: 96 }),
      accessible: 300_000,
      pension: 150_000,
    };
    const result = runFireCalc(req);
    expect(result.id).toBe(2);
    expect(result.solvedAge).toBeNull();
    expect(result.curve).toEqual([]);
    // In earliest mode the headline age mirrors solvedAge, so it's also null,
    // meaning no Monte Carlo run is needed.
    expect(result.headlineAge).toBeNull();
    expect(result.mc).toBeNull();
    expect(result.sensitivity).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const req: FireCalcRequest = {
      id: 3,
      settings: makeSettings({ returnVolatility: 12 }),
      accessible: 250_000,
      pension: 120_000,
    };
    const a = runFireCalc(req);
    const b = runFireCalc(req);
    expect(a).toEqual(b);
  });
});
