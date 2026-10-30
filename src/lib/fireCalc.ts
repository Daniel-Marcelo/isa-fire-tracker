// Pure stress-test core, shared by the Web Worker (fireWorker.ts) and the
// main-thread fallback in useStressTest.ts, so the two paths can't drift.
import type { FireSettings } from '../types';
import { runMonteCarlo, successCurve, type MonteCarloResult } from './monteCarlo';
import { runBacktest, type BacktestResult } from './historicalBacktest';
import { planToAgeOf, type FirePots } from './fireEngine';

export interface FireCalcRequest {
  id: number;
  settings: FireSettings;
  pots: FirePots;
  /** Age the steady-return plan retires at; null when it never gets there. */
  retireAge: number | null;
}

export interface FireCalcResult {
  id: number;
  mc: MonteCarloResult | null;
  backtest: BacktestResult | null;
  curve: { age: number; pct: number }[];
  sensitivity: { later: number; lessSpend: number } | null;
}

// The headline and sensitivity runs share a count and seed (common random numbers)
// so the chips' deltas are real, not noise. 600 gives ±~1.6pp. The curve is only a
// visual shape, so it can be coarser.
export const MC_RUNS = 600;
export const CURVE_RUNS = 300;

export function runFireCalc({ id, settings, pots, retireAge }: FireCalcRequest): FireCalcResult {
  const planTo = planToAgeOf(settings);
  const degenerate = planTo <= settings.currentAge + 1;
  const curve = degenerate ? [] : successCurve(settings, pots, { runs: CURVE_RUNS });
  if (retireAge == null || degenerate) {
    return { id, mc: null, backtest: null, curve, sensitivity: null };
  }

  const mc = runMonteCarlo(settings, pots, retireAge, { runs: MC_RUNS });
  const backtest = runBacktest(settings, pots, retireAge);
  const later = retireAge + 1 < planTo
    ? runMonteCarlo(settings, pots, retireAge + 1, { runs: MC_RUNS })
    : mc;
  const lessSpend = runMonteCarlo(
    { ...settings, annualExpensesInRetirement: Math.max(settings.annualExpensesInRetirement - 2000, 0) },
    pots, retireAge, { runs: MC_RUNS },
  );
  return { id, mc, backtest, curve, sensitivity: { later: later.successRate, lessSpend: lessSpend.successRate } };
}
