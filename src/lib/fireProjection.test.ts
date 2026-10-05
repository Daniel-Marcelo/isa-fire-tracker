import { describe, it, expect } from 'vitest';
import { realMonthlyRate, findFireAges, project } from './fireProjection';
import { runMonteCarlo } from './monteCarlo';
import { potsFromAccessible, type FirePots } from './fireEngine';
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
function deterministicSurvives(settings: FireSettings, pots: FirePots, retireAge: number): boolean {
  const mc = runMonteCarlo({ ...settings, returnVolatility: 0 }, pots, retireAge, { runs: 1 });
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
    const { earlyFireAge, fullFireAge } = findFireAges(settings, potsFromAccessible(0, 0));
    expect(earlyFireAge).toBeNull();
    expect(fullFireAge).toBeNull();
  });

  it('gives immediate earlyFireAge when the accessible pot is huge', () => {
    const settings = makeSettings({ currentAge: 30, pensionAccessAge: 57 });
    const { earlyFireAge } = findFireAges(settings, potsFromAccessible(10_000_000, 0));
    expect(earlyFireAge).toBe(30);
  });

  it('with a large pot entirely in pension: no bridge (earlyFireAge null), fullFireAge = pension access age', () => {
    const settings = makeSettings({ currentAge: 30, pensionAccessAge: 57 });
    const { earlyFireAge, fullFireAge } = findFireAges(settings, potsFromAccessible(0, 5_000_000));
    expect(earlyFireAge).toBeNull();
    expect(fullFireAge).toBe(57);
  });

  it('cash does not inflate earlyFireAge the way equity would — large cash alone still needs a long bridge', () => {
    // £200k cash at ~0% real cannot fund £25k/yr forever; the same amount in ISA at 7%/3% can.
    const settings = makeSettings({
      currentAge: 40,
      monthlyContribution: 0,
      annualExpensesInRetirement: 25000,
      cashAnnualReturn: 3, // matches inflation → ~0% real
      expectedAnnualReturn: 7,
      inflationRate: 3,
    });
    const cashOnly = findFireAges(settings, { cash: 200_000, isa: 0, gia: 0, pension: 0 });
    const isaOnly = findFireAges(settings, { cash: 0, isa: 200_000, gia: 0, pension: 0 });
    // ISA should reach FIRE no later than cash (usually strictly earlier).
    const cashAge = cashOnly.earlyFireAge ?? cashOnly.fullFireAge;
    const isaAge = isaOnly.earlyFireAge ?? isaOnly.fullFireAge;
    if (isaAge != null && cashAge != null) {
      expect(isaAge).toBeLessThanOrEqual(cashAge);
    } else {
      // Cash may be unreachable while ISA is reachable.
      expect(isaAge).not.toBeNull();
    }
  });

  it('the returned FIRE age survives to planToAge and one year earlier does not', () => {
    const settings = makeSettings({ currentAge: 30, monthlyContribution: 1500 });
    const pots = potsFromAccessible(50_000, 0);
    const { earlyFireAge } = findFireAges(settings, pots);
    expect(earlyFireAge).not.toBeNull();
    expect(earlyFireAge!).toBeGreaterThan(settings.currentAge);
    expect(deterministicSurvives(settings, pots, earlyFireAge!)).toBe(true);
    expect(deterministicSurvives(settings, pots, earlyFireAge! - 1)).toBe(false);
  });

  it('enabling the state pension never gives a later FIRE age', () => {
    const base = makeSettings({ currentAge: 35, monthlyContribution: 1200, monthlyPensionContribution: 300 });
    const withSp = { ...base, statePensionEnabled: true, statePensionAnnual: 12000, statePensionAge: 67 };
    const pots = potsFromAccessible(80_000, 40_000);
    const off = findFireAges(base, pots);
    const on = findFireAges(withSp, pots);
    const offAge = off.earlyFireAge ?? off.fullFireAge;
    const onAge = on.earlyFireAge ?? on.fullFireAge;
    expect(offAge).not.toBeNull();
    expect(onAge).not.toBeNull();
    expect(onAge!).toBeLessThanOrEqual(offAge!);
  });
});

describe('project', () => {
  const settings = makeSettings({ currentAge: 30, monthlyContribution: 1000 });
  const result = project(settings, potsFromAccessible(0, 0));

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

  it('routes new contributions into the ISA pot, not cash or GIA', () => {
    const s = makeSettings({ currentAge: 30, monthlyContribution: 1000, expectedAnnualReturn: 0, inflationRate: 0, cashAnnualReturn: 0 });
    const r = project(s, { cash: 0, isa: 0, gia: 0, pension: 0 });
    // After one year of contributing with zero returns: ISA = 12_000, cash/gia = 0
    expect(r.points[1].isa).toBe(12_000);
    expect(r.points[1].cash).toBe(0);
    expect(r.points[1].gia).toBe(0);
  });

  it('respects a shorter planToAge horizon', () => {
    const short = project(makeSettings({ currentAge: 30, monthlyContribution: 1000, planToAge: 85 }), potsFromAccessible(0, 0));
    expect(short.points[short.points.length - 1].age).toBe(85);
  });

  it('reports zero withdrawals before retirement and positive ones after', () => {
    const s = makeSettings({ currentAge: 30, monthlyContribution: 1500 });
    const r = project(s, potsFromAccessible(50_000, 0));
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
    const r = project(s, potsFromAccessible(500_000, 200_000));
    for (const pt of r.points) {
      if (pt.age > 67) expect(pt.accWithdrawn + pt.penWithdrawn).toBe(0);
    }
  });
});
