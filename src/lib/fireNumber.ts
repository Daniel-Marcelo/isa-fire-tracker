import type { FireSettings } from '../types';
import { drawdownParamsFrom, sumAccessible, sumAll, withdrawalRateOf, type FirePots } from './fireEngine';

/** Rule-of-thumb target, in today's money. Does not gross up for tax. */
export interface FireNumber {
  /** Fraction, e.g. 0.035. */
  withdrawalRate: number;
  /** Portfolio that funds all spending at the withdrawal rate. */
  target: number;
  /** Portfolio needed once the state pension starts; equals target when it's off. */
  targetWithStatePension: number;
  statePensionAge: number | null;
  invested: number;
  accessible: number;
  pension: number;
  /** What the portfolio supports per year at the withdrawal rate today. */
  safeIncomeToday: number;
  /** invested / target; 1 when spending is zero. */
  progress: number;
}

export function fireNumberOf(settings: FireSettings, pots: FirePots): FireNumber {
  const rate = withdrawalRateOf(settings) / 100;
  const dd = drawdownParamsFrom(settings);
  const spend = dd.monthlySpend * 12;
  const statePension = dd.statePensionMonthly * 12;
  const invested = sumAll(pots);
  const target = spend / rate;
  return {
    withdrawalRate: rate,
    target,
    targetWithStatePension: Math.max(spend - statePension, 0) / rate,
    statePensionAge: statePension > 0 ? dd.statePensionAge : null,
    invested,
    accessible: sumAccessible(pots),
    pension: Math.max(pots.pension, 0),
    safeIncomeToday: invested * rate,
    progress: target > 0 ? invested / target : 1,
  };
}
