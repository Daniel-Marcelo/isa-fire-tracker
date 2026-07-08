import { describe, it, expect } from 'vitest';
import { realMonthlyRate, findFireAges, project } from './fireProjection';
import { runMonteCarlo } from './monteCarlo';
import type { FireSettings } from '../types';

function makeSettings(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    currentAge: 30,
    targetRetirementAge: 55,
    monthlyContribution: 0,
    monthlyPensionContribution: 0,
    pensionAccessAge: 57,
    expectedAnnualReturn: 7,
    inflationRate: 3,
    annualExpensesInRetirement: 25000,
    withdrawalRate: 3.5,
    statePensionEnabled: false, // keep scenarios pure unless a test opts in
    ...overrides,
  };
}

/** σ=0 Monte Carlo is the deterministic path — use it as the survival oracle. */
function deterministicSurvives(settings: FireSettings, acc: number, pen: number, retireAge: number): boolean {
  const mc = runMonteCarlo({ ...settings, returnVolatility: 0 }, acc, pen, retireAge, { runs: 1 });
  return mc.successRate === 1;
}

describe('realMonthlyRate', () => {
  it('matches the real-return compounding formula', () => {
    const expected = Math.pow(1.07 / 1.03, 1 / 12) - 1;
    expect(realMonthlyRate(7, 3)).toBeCloseTo(expected, 10);
  });
});

describe('findFireAges (survival-based)', () => {
  it('returns both ages null with zero contributions, zero savings, nonzero expenses', () => {
    const settings = makeSettings({ monthlyContribution: 0, monthlyPensionContribution: 0 });
    const { earlyFireAge, fullFireAge } = findFireAges(settings, 0, 0);
    expect(earlyFireAge).toBeNull();
    expect(fullFireAge).toBeNull();
  });

  it('gives immediate earlyFireAge when the accessible pot is huge', () => {
    const settings = makeSettings({ currentAge: 30, pensionAccessAge: 57 });
    const { earlyFireAge } = findFireAges(settings, 10_000_000, 0, );
    expect(earlyFireAge).toBe(30);
  });

  it('with a large pot entirely in pension: no bridge (earlyFireAge null), fullFireAge = pension access age', () => {
    const settings = makeSettings({ currentAge: 30, pensionAccessAge: 57 });
    const { earlyFireAge, fullFireAge } = findFireAges(settings, 0, 5_000_000);
    expect(earlyFireAge).toBeNull();
    expect(fullFireAge).toBe(57);
  });

  it('the returned FIRE age survives to planToAge and one year earlier does not', () => {
    const settings = makeSettings({ currentAge: 30, monthlyContribution: 1500 });
    const acc = 50_000;
    const { earlyFireAge } = findFireAges(settings, acc, 0);
    expect(earlyFireAge).not.toBeNull();
    expect(earlyFireAge!).toBeGreaterThan(settings.currentAge);
    expect(deterministicSurvives(settings, acc, 0, earlyFireAge!)).toBe(true);
    expect(deterministicSurvives(settings, acc, 0, earlyFireAge! - 1)).toBe(false);
  });

  it('enabling the state pension never gives a later FIRE age', () => {
    const base = makeSettings({ currentAge: 35, monthlyContribution: 1200, monthlyPensionContribution: 300 });
    const withSp = { ...base, statePensionEnabled: true, statePensionAnnual: 12000, statePensionAge: 67 };
    const acc = 80_000, pen = 40_000;
    const off = findFireAges(base, acc, pen);
    const on = findFireAges(withSp, acc, pen);
    const offAge = off.earlyFireAge ?? off.fullFireAge;
    const onAge = on.earlyFireAge ?? on.fullFireAge;
    expect(offAge).not.toBeNull();
    expect(onAge).not.toBeNull();
    expect(onAge!).toBeLessThanOrEqual(offAge!);
  });
});

describe('project', () => {
  const settings = makeSettings({ currentAge: 30, monthlyContribution: 1000 });
  const result = project(settings, 0, 0);

  it('starts at the current age and produces yearly points through planToAge (default 95 → 66 entries)', () => {
    expect(result.points[0].age).toBe(30);
    expect(result.points).toHaveLength(66);
    expect(result.points[result.points.length - 1].age).toBe(95);
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

  it('respects a shorter planToAge horizon', () => {
    const short = project(makeSettings({ currentAge: 30, monthlyContribution: 1000, planToAge: 85 }), 0, 0);
    expect(short.points[short.points.length - 1].age).toBe(85);
  });

  it('reports zero withdrawals before retirement and positive ones after', () => {
    const s = makeSettings({ currentAge: 30, monthlyContribution: 1500 });
    const r = project(s, 50_000, 0);
    const fireAge = r.earlyFireAge ?? r.fullFireAge;
    expect(fireAge).not.toBeNull();
    for (const pt of r.points) {
      if (pt.age <= Math.round(fireAge!)) {
        // the point at the FIRE age reports the year *ending* there, still pre-retirement
        expect(pt.accWithdrawn + pt.penWithdrawn).toBe(0);
      }
    }
    const afterFire = r.points.filter(pt => pt.age > Math.round(fireAge!));
    expect(afterFire.length).toBeGreaterThan(0);
    for (const pt of afterFire) {
      expect(pt.accWithdrawn + pt.penWithdrawn).toBeGreaterThan(0);
    }
  });

  it('a state pension covering all spending zeroes withdrawals from its start age', () => {
    const s = makeSettings({
      currentAge: 50,
      monthlyContribution: 2000,
      annualExpensesInRetirement: 10000,
      statePensionEnabled: true,
      statePensionAnnual: 12000,
      statePensionAge: 67,
    });
    const r = project(s, 500_000, 200_000, );
    for (const pt of r.points) {
      if (pt.age > 67) expect(pt.accWithdrawn + pt.penWithdrawn).toBe(0);
    }
  });
});
