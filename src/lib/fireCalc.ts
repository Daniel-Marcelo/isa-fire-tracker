// Pure FIRE calculation core, shared by the Web Worker (fireWorker.ts) and the
// main-thread fallback in FIRECalculator.tsx. Keeping this logic in one place
// means the two execution paths can never drift from each other.
import type { FireSettings } from '../types';
import { runMonteCarlo, solveEarliestFireAge, solveRequiredContribution, successCurve, type MonteCarloResult } from './monteCarlo';
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
  requiredContribution: number | null;
}

// The solver runs ~10 sims and drives the headline age, so it and the headline/
// sensitivity runs must share a count to stay mutually consistent (the solver
// mustn't claim "meets 78%" while the headline reads 77%). 600 gives ±~1.6pp —
// plenty for an estimate — at roughly half the cost of 1,000. The curve is only
// a visual shape, so it can be coarser still.
export const MC_RUNS = 600;
export const CURVE_RUNS = 300;

export function runFireCalc(req: FireCalcRequest): FireCalcResult {
  const { id, settings, accessible, pension } = req;

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

  // In earliest mode, solve for the age that's actually headlined (falling back to
  // chosenAge if unreachable so the card still has something to show); in fixedAge
  // mode it's always the chosen age. Use MC_RUNS (not the module's DEFAULT_RUNS) so
  // this number is consistent with the confidence shown elsewhere.
  const targetAge = mode === 'earliest' ? (solvedAge ?? chosenAge) : chosenAge;
  const requiredContribution = degenerate
    ? null
    : solveRequiredContribution(settings, accessible, pension, targetAge, { runs: MC_RUNS });

  return { id, solvedAge, headlineAge, mc, curve, sensitivity, requiredContribution };
}
