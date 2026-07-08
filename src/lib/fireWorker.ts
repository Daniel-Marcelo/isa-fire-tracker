// Web Worker: runs the heavy Monte Carlo suite off the main thread so typing in
// the FIRE inputs never blocks. A single recompute is ~40 full simulations
// (~4s on the main thread); here it runs in the background and posts results
// back. The engine functions are pure, so they import unchanged.
import type { FireSettings } from '../types';
import { runMonteCarlo, solveEarliestFireAge, successCurve, type MonteCarloResult } from './monteCarlo';
import { planToAgeOf } from './fireEngine';

export interface FireCalcRequest {
  id: number;
  settings: FireSettings;
  accessible: number;
  pension: number;
}

export interface FireCalcResult {
  id: number;
  solvedAge: number | null;
  headlineAge: number | null;
  mc: MonteCarloResult | null;
  curve: { age: number; pct: number }[];
  sensitivity: { later: number; lessSpend: number } | null;
}

// The solver runs ~10 sims and drives the headline age, so it and the headline/
// sensitivity runs must share a count to stay mutually consistent (the solver
// mustn't claim "meets 78%" while the headline reads 77%). 600 gives ±~1.6pp —
// plenty for an estimate — at roughly half the cost of 1,000. The curve is only
// a visual shape, so it can be coarser still.
const MC_RUNS = 600;
const CURVE_RUNS = 300;

// Cast around the DOM/webworker lib overlap: postMessage in a dedicated worker
// takes just the message, but the DOM-lib `self` types it as Window's variant.
const post = (msg: FireCalcResult) =>
  (self as unknown as { postMessage(m: FireCalcResult): void }).postMessage(msg);

self.onmessage = (e: MessageEvent<FireCalcRequest>) => {
  const { id, settings, accessible, pension } = e.data;

  const planTo = planToAgeOf(settings);
  const degenerate = planTo <= settings.currentAge + 1;
  const mode = settings.fireMode ?? 'earliest';

  const solvedAge = degenerate ? null : solveEarliestFireAge(settings, accessible, pension, { runs: MC_RUNS });
  // Stale persisted values (v1 default 55) can sit below currentAge or beyond planToAge.
  const chosenAge = Math.min(Math.max(settings.targetRetirementAge ?? 55, settings.currentAge), planTo);
  const headlineAge = mode === 'earliest' ? solvedAge : chosenAge;

  const mc = headlineAge != null ? runMonteCarlo(settings, accessible, pension, headlineAge, { runs: MC_RUNS }) : null;
  const curve = degenerate ? [] : successCurve(settings, accessible, pension, { runs: CURVE_RUNS });

  // Same seed and run count as the headline (common random numbers) so the deltas are real.
  let sensitivity: FireCalcResult['sensitivity'] = null;
  if (headlineAge != null && !degenerate) {
    const later = runMonteCarlo(settings, accessible, pension, Math.min(headlineAge + 1, planTo - 1), { runs: MC_RUNS });
    const lessSpend = runMonteCarlo(
      { ...settings, annualExpensesInRetirement: Math.max(settings.annualExpensesInRetirement - 2000, 0) },
      accessible, pension, headlineAge, { runs: MC_RUNS },
    );
    sensitivity = { later: later.successRate, lessSpend: lessSpend.successRate };
  }

  post({ id, solvedAge, headlineAge, mc, curve, sensitivity });
};
