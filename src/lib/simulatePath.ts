import type { FireSettings } from '../types';
import {
  cashAnnualReturnOf,
  drawdownParamsFrom,
  monthlyWithdrawals,
  rawAccessible,
  rawTotal,
  sumAll,
  type DrawdownParams,
  type FirePots,
} from './fireEngine';

export interface PathSetup {
  currentAge: number;
  retireAge: number;
  months: number;
  /** Yearly wealth samples per path, including the start. */
  years: number;
  /** Real annual equity return from the settings, e.g. 0.0388. */
  realAnnual: number;
  /** Monthly cash growth factor; cash has no volatility. */
  cashGrowth: number;
  monthlyIsa: number;
  monthlyPension: number;
  dd: DrawdownParams;
}

export function pathSetup(settings: FireSettings, retireAge: number, endAge: number): PathSetup {
  const { currentAge, monthlyContribution, monthlyPensionContribution, expectedAnnualReturn, inflationRate } = settings;
  const realAnnual = (1 + expectedAnnualReturn / 100) / (1 + inflationRate / 100) - 1;
  const cashRealAnnual = (1 + cashAnnualReturnOf(settings) / 100) / (1 + inflationRate / 100) - 1;
  const months = Math.round((endAge - currentAge) * 12);
  return {
    currentAge,
    retireAge,
    months,
    years: Math.floor(months / 12) + 1,
    realAnnual,
    cashGrowth: Math.pow(1 + cashRealAnnual, 1 / 12),
    monthlyIsa: monthlyContribution,
    monthlyPension: monthlyPensionContribution ?? 0,
    dd: drawdownParamsFrom(settings),
  };
}

/**
 * One path through accumulation and drawdown. equityGrowth(m) is the growth factor
 * for ISA, GIA and pension in month m. sample(yearIndex, wealth) fires at the start
 * of each year and once at the end. A path fails if the bridge can't be funded
 * before pension access, or the combined pot is exhausted after it.
 */
export function simulatePath(
  setup: PathSetup,
  pots0: FirePots,
  equityGrowth: (month: number) => number,
  sample?: (yearIndex: number, wealth: number) => void,
): { failed: boolean; endWealth: number } {
  const { currentAge, retireAge, months, years, cashGrowth, monthlyIsa, monthlyPension, dd } = setup;
  let pots: FirePots = { cash: pots0.cash, isa: pots0.isa, gia: pots0.gia, pension: pots0.pension };
  let failed = false;

  for (let m = 0; m < months; m++) {
    const age = currentAge + m / 12;
    if (m % 12 === 0) sample?.(m / 12, sumAll(pots));

    const g = equityGrowth(m);
    pots = {
      cash: pots.cash * cashGrowth,
      isa: pots.isa * g,
      gia: pots.gia * g,
      pension: pots.pension * g,
    };

    if (age < retireAge) {
      pots.isa += monthlyIsa;
      pots.pension += monthlyPension;
    } else {
      const w = monthlyWithdrawals(age, pots, dd);
      pots.cash -= w.fromCash;
      pots.isa -= w.fromIsa;
      pots.gia -= w.fromGia;
      pots.pension -= w.fromPension;
      if (age < dd.pensionAccessAge) {
        if (w.unmetNeed > 0 || rawAccessible(pots) < 0) {
          failed = true;
          pots.cash = Math.max(pots.cash, 0);
          pots.isa = Math.max(pots.isa, 0);
          pots.gia = Math.max(pots.gia, 0);
        }
      } else if (rawTotal(pots) < 0) {
        failed = true;
      }
    }
  }

  const endWealth = sumAll(pots);
  const lastYear = Math.floor((months - 1) / 12);
  if (lastYear + 1 < years) sample?.(lastYear + 1, endWealth);
  return { failed, endWealth };
}
