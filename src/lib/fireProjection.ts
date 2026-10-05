import type { FireSettings } from '../types';
import {
  accessibleWithdrawn,
  cashAnnualReturnOf,
  drawdownParamsFrom,
  monthlyWithdrawals,
  planToAgeOf,
  rawAccessible,
  rawTotal,
  sumAccessible,
  sumAll,
  type DrawdownParams,
  type FirePots,
} from './fireEngine';

export interface ProjectionResult {
  points: {
    age: number;
    cash: number;
    isa: number;
    gia: number;
    /** cash + isa + gia — kept for the existing chart/table. */
    accessible: number;
    pension: number;
    combined: number;
    /** Pot outflows during the year ending at this point (gross of tax/CGT). */
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

function clonePots(p: FirePots): FirePots {
  return { cash: p.cash, isa: p.isa, gia: p.gia, pension: p.pension };
}

/**
 * Apply one month of growth (cash at its own rate; equity pots at equity rate)
 * then either contribute or withdraw.
 */
function stepMonth(
  pots: FirePots,
  age: number,
  equityRate: number,
  cashRate: number,
  monthlyIsa: number,
  monthlyPension: number,
  retired: boolean,
  dd: DrawdownParams,
): { pots: FirePots; withdrawn: ReturnType<typeof monthlyWithdrawals> | null } {
  const next: FirePots = {
    cash: pots.cash * (1 + cashRate),
    isa: pots.isa * (1 + equityRate),
    gia: pots.gia * (1 + equityRate),
    pension: pots.pension * (1 + equityRate),
  };

  if (!retired) {
    next.isa += monthlyIsa;
    next.pension += monthlyPension;
    return { pots: next, withdrawn: null };
  }

  const w = monthlyWithdrawals(age, next, dd);
  next.cash -= w.fromCash;
  next.isa -= w.fromIsa;
  next.gia -= w.fromGia;
  next.pension -= w.fromPension;
  return { pots: next, withdrawn: w };
}

/**
 * Deterministic survival check: retiring at retireAge with these pots, does the
 * plan stay solvent through planToAge? Fails if non-pension pots can't fund the
 * bridge, or the combined pot goes negative after pension access.
 */
function survivesRetiringAt(
  retireAge: number,
  start: FirePots,
  equityRate: number,
  cashRate: number,
  monthsToPlanEnd: number,
  dd: DrawdownParams,
): boolean {
  let pots = clonePots(start);
  for (let i = 0; i < monthsToPlanEnd; i++) {
    const age = retireAge + i / 12;
    const { pots: next, withdrawn: w } = stepMonth(
      pots, age, equityRate, cashRate, 0, 0, true, dd,
    );
    pots = next;
    if (!w) continue;
    if (age < dd.pensionAccessAge) {
      if (w.unmetNeed > 1e-6 || rawAccessible(pots) < -1e-6) return false;
    } else if (rawTotal(pots) < -1e-6) {
      return false;
    }
  }
  return true;
}

/**
 * Survival-based FIRE ages: the earliest age (yearly check cadence) from which the
 * deterministic simulation keeps the bridge solvent and the combined pot ≥ 0
 * through planToAge. earlyFireAge is before pension access; fullFireAge means
 * the plan survives when retiring at/after pension access.
 */
export function findFireAges(
  settings: FireSettings,
  pots0: FirePots,
): { earlyFireAge: number | null; fullFireAge: number | null } {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;
  const equityRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const cashRate = realMonthlyRate(cashAnnualReturnOf(settings), inflationRate);
  const monthlyPension = monthlyPensionContribution ?? 0;
  const dd = drawdownParamsFrom(settings);
  const months = horizonMonths(settings);

  let pots = clonePots(pots0);
  let earlyFireAge: number | null = null;
  let fullFireAge: number | null = null;

  for (let m = 0; m <= months; m++) {
    const age = currentAge + m / 12;

    // At m === months the retirement horizon is zero, which survivesRetiringAt
    // would trivially "pass"; a zero-length retirement is not a real FIRE age.
    if (m % 12 === 0 && months - m > 0) {
      const survives = () => survivesRetiringAt(age, pots, equityRate, cashRate, months - m, dd);
      if (earlyFireAge === null && age < dd.pensionAccessAge && survives()) earlyFireAge = age;
      if (fullFireAge === null && age >= dd.pensionAccessAge && survives()) fullFireAge = age;
      if (earlyFireAge !== null && fullFireAge !== null) break;
    }

    const retiredYet = earlyFireAge !== null && age >= earlyFireAge;
    const stepped = stepMonth(
      pots, age, equityRate, cashRate,
      retiredYet ? 0 : monthlyContribution,
      retiredYet ? 0 : monthlyPension,
      false, // accumulation path — withdrawals are only in the survival check
      dd,
    );
    pots = stepped.pots;
  }

  return { earlyFireAge, fullFireAge };
}

export function project(
  settings: FireSettings,
  pots0: FirePots,
): ProjectionResult {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;

  const equityRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const cashRate = realMonthlyRate(cashAnnualReturnOf(settings), inflationRate);
  const monthlyPension = monthlyPensionContribution ?? 0;
  const dd = drawdownParamsFrom(settings);
  const months = horizonMonths(settings);

  const { earlyFireAge, fullFireAge } = findFireAges(settings, pots0);
  const retireAge = Math.min(earlyFireAge ?? Infinity, fullFireAge ?? Infinity);

  const points: ProjectionResult['points'] = [];
  let pots = clonePots(pots0);
  let accOutThisYear = 0;
  let penOutThisYear = 0;

  for (let m = 0; m <= months; m++) {
    const age = currentAge + m / 12;
    const retired = isFinite(retireAge) && age >= retireAge;

    if (m % 12 === 0) {
      points.push({
        age: Math.round(age),
        cash: Math.round(Math.max(pots.cash, 0)),
        isa: Math.round(Math.max(pots.isa, 0)),
        gia: Math.round(Math.max(pots.gia, 0)),
        accessible: Math.round(Math.max(sumAccessible(pots), 0)),
        pension: Math.round(Math.max(pots.pension, 0)),
        combined: Math.round(Math.max(sumAll(pots), 0)),
        accWithdrawn: Math.round(accOutThisYear),
        penWithdrawn: Math.round(penOutThisYear),
      });
      accOutThisYear = 0;
      penOutThisYear = 0;
    }

    const stepped = stepMonth(
      pots, age, equityRate, cashRate,
      retired ? 0 : monthlyContribution,
      retired ? 0 : monthlyPension,
      retired, dd,
    );
    pots = stepped.pots;
    if (stepped.withdrawn) {
      accOutThisYear += accessibleWithdrawn(stepped.withdrawn);
      penOutThisYear += stepped.withdrawn.fromPension;
    }
  }

  return { points, earlyFireAge, fullFireAge };
}
