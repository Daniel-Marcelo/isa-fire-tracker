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
  type MonthlyWithdrawal,
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
  /** Age the plan retires at: the override, else the earliest surviving age. */
  retireAge: number | null;
  /** Whole age at which the money first runs short; null if it lasts to planToAge. */
  depletedAge: number | null;
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

/** Bridge unfunded before pension access, or the combined pot exhausted after it. */
function failsThisMonth(age: number, pots: FirePots, w: MonthlyWithdrawal, dd: DrawdownParams): boolean {
  if (age < dd.pensionAccessAge) return w.unmetNeed > 1e-6 || rawAccessible(pots) < -1e-6;
  return rawTotal(pots) < -1e-6;
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
    if (w && failsThisMonth(age, pots, w, dd)) return false;
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

/** One pass: accumulate until retireAge, then draw down to planToAge. */
export function planSurvives(settings: FireSettings, pots0: FirePots, retireAge: number): boolean {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;
  const equityRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const cashRate = realMonthlyRate(cashAnnualReturnOf(settings), inflationRate);
  const monthlyPension = monthlyPensionContribution ?? 0;
  const dd = drawdownParamsFrom(settings);
  const months = horizonMonths(settings);

  let pots = clonePots(pots0);
  for (let m = 0; m < months; m++) {
    const age = currentAge + m / 12;
    const retired = age >= retireAge;
    const stepped = stepMonth(
      pots, age, equityRate, cashRate,
      retired ? 0 : monthlyContribution,
      retired ? 0 : monthlyPension,
      retired, dd,
    );
    pots = stepped.pots;
    if (stepped.withdrawn && failsThisMonth(age, pots, stepped.withdrawn, dd)) return false;
  }
  return true;
}

/**
 * Smallest total monthly saving (ISA + pension, current split kept) that makes the
 * steady-return plan last when retiring at retireAge. 0 if no saving is needed,
 * null if no saving level gets there.
 */
export function requiredSavingFor(settings: FireSettings, pots: FirePots, retireAge: number): number | null {
  if (retireAge <= settings.currentAge) return planSurvives(settings, pots, retireAge) ? 0 : null;

  const acc0 = Math.max(settings.monthlyContribution, 0);
  const pen0 = Math.max(settings.monthlyPensionContribution ?? 0, 0);
  const base = acc0 + pen0;
  // With no saving today, route new money to the ISA: the bridge pot usually binds.
  const isaShare = base > 0 ? acc0 / base : 1;
  const works = (total: number) => planSurvives(
    { ...settings, monthlyContribution: total * isaShare, monthlyPensionContribution: total * (1 - isaShare) },
    pots, retireAge,
  );

  if (works(0)) return 0;
  let hi = Math.max(base, 500);
  for (let guard = 0; !works(hi); guard++) {
    if (guard >= 20) return null;
    hi *= 2;
  }
  let lo = 0;
  while (hi - lo > 10) {
    const mid = (lo + hi) / 2;
    if (works(mid)) hi = mid; else lo = mid;
  }
  return Math.ceil(hi / 10) * 10;
}

export function project(
  settings: FireSettings,
  pots0: FirePots,
  retireAgeOverride?: number,
): ProjectionResult {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;

  const equityRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const cashRate = realMonthlyRate(cashAnnualReturnOf(settings), inflationRate);
  const monthlyPension = monthlyPensionContribution ?? 0;
  const dd = drawdownParamsFrom(settings);
  const months = horizonMonths(settings);

  const { earlyFireAge, fullFireAge } = findFireAges(settings, pots0);
  const retireAge = retireAgeOverride ?? Math.min(earlyFireAge ?? Infinity, fullFireAge ?? Infinity);

  const points: ProjectionResult['points'] = [];
  let pots = clonePots(pots0);
  let accOutThisYear = 0;
  let penOutThisYear = 0;
  let depletedAge: number | null = null;

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
      // The loop's last step (m === months) is past the planToAge survival horizon.
      if (depletedAge === null && m < months && failsThisMonth(age, pots, stepped.withdrawn, dd)) depletedAge = Math.floor(age);
    }
  }

  return { points, earlyFireAge, fullFireAge, retireAge: isFinite(retireAge) ? retireAge : null, depletedAge };
}
