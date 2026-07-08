import type { FireSettings } from '../types';
import { drawdownParamsFrom, monthlyWithdrawals, planToAgeOf, type DrawdownParams } from './fireEngine';

export interface ProjectionResult {
  points: {
    age: number;
    accessible: number;
    pension: number;
    combined: number;
    /** Pot outflows during the year ending at this point (post-state-pension, tax-grossed). */
    accWithdrawn: number;
    penWithdrawn: number;
  }[];
  earlyFireAge: number | null;
  fullFireAge: number | null;
}

export function realMonthlyRate(nominalPct: number, inflationPct: number): number {
  const realAnnual = (1 + nominalPct / 100) / (1 + inflationPct / 100) - 1;
  return Math.pow(1 + realAnnual, 1 / 12) - 1;
}

/** Simulation horizon in months; capped so extreme age spans can't balloon the table or MC cost. */
export function horizonMonths(settings: FireSettings): number {
  return Math.min(Math.max(Math.round((planToAgeOf(settings) - settings.currentAge) * 12), 12), 900);
}

/**
 * Deterministic (smooth-market) survival check: retiring at retireAge with these
 * pots, does the plan stay solvent through planToAge? Fails if the accessible pot
 * empties during the bridge, or the combined pot goes negative afterwards.
 */
function survivesRetiringAt(
  retireAge: number,
  accessibleStart: number,
  pensionStart: number,
  mRate: number,
  monthsToPlanEnd: number,
  dd: DrawdownParams,
): boolean {
  let accessible = accessibleStart;
  let pension = pensionStart;
  for (let i = 0; i < monthsToPlanEnd; i++) {
    const age = retireAge + i / 12;
    const w = monthlyWithdrawals(age, accessible, pension, dd);
    accessible = accessible * (1 + mRate) - w.fromAccessible;
    pension = pension * (1 + mRate) - w.fromPension;
    if (age < dd.pensionAccessAge) {
      if (accessible < 0) return false;
    } else if (accessible + pension < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Survival-based FIRE ages: the earliest age (yearly check cadence) from which the
 * deterministic simulation keeps the bridge solvent and the combined pot ≥ 0
 * through planToAge. earlyFireAge is before pension access (the ISA bridge);
 * fullFireAge means the plan survives when retiring at/after pension access.
 */
export function findFireAges(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
): { earlyFireAge: number | null; fullFireAge: number | null } {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;
  const mRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const totalMonthlyPension = monthlyPensionContribution ?? 0;
  const dd = drawdownParamsFrom(settings);
  const months = horizonMonths(settings);

  let accessible = accessibleStart;
  let pension = pensionStart;
  let earlyFireAge: number | null = null;
  let fullFireAge: number | null = null;

  for (let m = 0; m <= months; m++) {
    const age = currentAge + m / 12;

    // At m === months the retirement horizon is zero, which survivesRetiringAt
    // would trivially "pass"; a zero-length retirement is not a real FIRE age.
    if (m % 12 === 0 && months - m > 0) {
      const survives = () => survivesRetiringAt(age, accessible, pension, mRate, months - m, dd);
      if (earlyFireAge === null && age < dd.pensionAccessAge && survives()) earlyFireAge = age;
      if (fullFireAge === null && age >= dd.pensionAccessAge && survives()) fullFireAge = age;
      if (earlyFireAge !== null && fullFireAge !== null) break;
    }

    const retiredYet = earlyFireAge !== null && age >= earlyFireAge;
    accessible = accessible * (1 + mRate) + (retiredYet ? 0 : monthlyContribution);
    pension = pension * (1 + mRate) + (retiredYet ? 0 : totalMonthlyPension);
  }

  return { earlyFireAge, fullFireAge };
}

export function project(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
): ProjectionResult {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;

  const mRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const totalMonthlyPension = monthlyPensionContribution ?? 0;
  const dd = drawdownParamsFrom(settings);
  const months = horizonMonths(settings);

  const { earlyFireAge, fullFireAge } = findFireAges(settings, accessibleStart, pensionStart);
  const retireAge = Math.min(earlyFireAge ?? Infinity, fullFireAge ?? Infinity);

  const points: ProjectionResult['points'] = [];
  let accessible = accessibleStart;
  let pension = pensionStart;
  let accOutThisYear = 0;
  let penOutThisYear = 0;

  for (let m = 0; m <= months; m++) {
    const age = currentAge + m / 12;
    const retired = isFinite(retireAge) && age >= retireAge;

    if (m % 12 === 0) {
      points.push({
        age: Math.round(age),
        accessible: Math.round(Math.max(accessible, 0)),
        pension: Math.round(Math.max(pension, 0)),
        combined: Math.round(Math.max(accessible, 0) + Math.max(pension, 0)),
        accWithdrawn: Math.round(accOutThisYear),
        penWithdrawn: Math.round(penOutThisYear),
      });
      accOutThisYear = 0;
      penOutThisYear = 0;
    }

    if (retired) {
      const w = monthlyWithdrawals(age, accessible, pension, dd);
      accessible = accessible * (1 + mRate) - w.fromAccessible;
      pension = pension * (1 + mRate) - w.fromPension;
      accOutThisYear += w.fromAccessible;
      penOutThisYear += w.fromPension;
    } else {
      accessible = accessible * (1 + mRate) + monthlyContribution;
      pension = pension * (1 + mRate) + totalMonthlyPension;
    }
  }

  return { points, earlyFireAge, fullFireAge };
}
