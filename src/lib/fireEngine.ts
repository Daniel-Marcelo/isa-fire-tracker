import type { FireSettings } from '../types';

/**
 * The one set of drawdown rules both the deterministic projection and the
 * Monte Carlo must agree on. Everything is in today's money.
 */
export interface DrawdownParams {
  pensionAccessAge: number;
  monthlySpend: number;          // net need, today's money
  statePensionMonthly: number;   // 0 when disabled
  statePensionAge: number;
  pensionTaxRate: number;        // fraction 0..0.6
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Derive drawdown params from settings, applying the defensive clamps here so
 * transient input states (NumberInput emits 0 for a cleared field) can never
 * reach the maths — in particular the tax gross-up's divide by (1 − rate).
 */
export function drawdownParamsFrom(settings: FireSettings): DrawdownParams {
  const statePensionOn = settings.statePensionEnabled ?? true;
  return {
    pensionAccessAge: settings.pensionAccessAge ?? 57,
    monthlySpend: Math.max(settings.annualExpensesInRetirement, 0) / 12,
    statePensionMonthly: statePensionOn ? Math.max(settings.statePensionAnnual ?? 12000, 0) / 12 : 0,
    statePensionAge: settings.statePensionAge ?? 67,
    pensionTaxRate: clamp((settings.pensionTaxRate ?? 15) / 100, 0, 0.6),
  };
}

/** Planning horizon in years, clamped so degenerate persisted values can't explode the sims. */
export function planToAgeOf(settings: FireSettings): number {
  return clamp(settings.planToAge ?? 95, 80, 105);
}

/** Target Monte Carlo confidence in %, clamped to a sane band. */
export function targetConfidenceOf(settings: FireSettings): number {
  return clamp(settings.targetConfidence ?? 90, 50, 99);
}

/** Pot outflows for one retired month. Positive numbers; caller subtracts. */
export function monthlyWithdrawals(
  age: number,
  accessible: number,
  pension: number,
  p: DrawdownParams,
): { fromAccessible: number; fromPension: number } {
  // The state pension is treated as net of tax; it just shrinks the need.
  const sp = age >= p.statePensionAge ? p.statePensionMonthly : 0;
  const need = Math.max(0, p.monthlySpend - sp);
  if (age < p.pensionAccessAge) {
    return { fromAccessible: need, fromPension: 0 }; // the bridge
  }
  const total = Math.max(accessible + pension, 0);
  const accRatio = total > 0 ? Math.max(accessible, 0) / total : 0;
  const fromAccessible = need * accRatio;
  // Pension withdrawals are grossed up so the *net* need is met after tax.
  const fromPension = (need * (1 - accRatio)) / (1 - p.pensionTaxRate);
  return { fromAccessible, fromPension };
}
