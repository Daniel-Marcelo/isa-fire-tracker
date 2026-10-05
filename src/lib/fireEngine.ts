import type { FireSettings, Provider } from '../types';
import { fireBucket } from '../utils';

/**
 * The four pots both the deterministic projection and the Monte Carlo must
 * agree on. Everything is in today's money (GBP).
 *
 * Draw order in retirement: cash → ISA → GIA (CGT gross-up) → pension after
 * access age (income-tax gross-up). Cash compounds at its own return with no
 * volatility; ISA/GIA/pension share the equity return.
 */
export interface FirePots {
  cash: number;
  isa: number;
  gia: number;
  pension: number;
}

/**
 * The one set of drawdown rules both engines share.
 */
export interface DrawdownParams {
  pensionAccessAge: number;
  monthlySpend: number;          // net need, today's money
  statePensionMonthly: number;   // 0 when disabled
  statePensionAge: number;
  pensionTaxRate: number;        // fraction 0..0.6
  giaCgtRate: number;            // fraction 0..0.4 — effective rate after allowance
}

/** Pot outflows for one retired month. Positive numbers; caller subtracts. */
export interface MonthlyWithdrawal {
  fromCash: number;
  fromIsa: number;
  /** Gross pot reduction (includes CGT). */
  fromGia: number;
  /** Gross pot reduction (includes income tax). */
  fromPension: number;
  /** Net spending still unpaid after draining available pots (bridge shortfall). */
  unmetNeed: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function emptyPots(): FirePots {
  return { cash: 0, isa: 0, gia: 0, pension: 0 };
}

/** Convenience for tests and call sites that still think in "accessible + pension". */
export function potsFromAccessible(accessible: number, pension: number): FirePots {
  return { cash: 0, isa: Math.max(accessible, 0), gia: 0, pension: Math.max(pension, 0) };
}

/** Non-negative accessible wealth — for display and band sampling. */
export function sumAccessible(p: FirePots): number {
  return Math.max(p.cash, 0) + Math.max(p.isa, 0) + Math.max(p.gia, 0);
}

/** Non-negative total wealth — for display and band sampling. */
export function sumAll(p: FirePots): number {
  return sumAccessible(p) + Math.max(p.pension, 0);
}

/**
 * Signed totals for solvency checks. Unlike sumAccessible/sumAll these do NOT
 * clamp — a negative pot must count, or an empty plan would look solvent.
 */
export function rawAccessible(p: FirePots): number {
  return p.cash + p.isa + p.gia;
}

export function rawTotal(p: FirePots): number {
  return p.cash + p.isa + p.gia + p.pension;
}

/** Sum holding values into the four FIRE buckets from account types. */
export function potsFromProviders(providers: Provider[]): FirePots {
  const pots = emptyPots();
  for (const p of providers) {
    const value = p.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
    pots[fireBucket(p.accountType)] += value;
  }
  return pots;
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
    giaCgtRate: clamp((settings.giaCgtRate ?? 10) / 100, 0, 0.4),
  };
}

/** Nominal cash return %/yr; default 3. Clamped so a cleared field can't go negative. */
export function cashAnnualReturnOf(settings: FireSettings): number {
  return Math.max(settings.cashAnnualReturn ?? 3, 0);
}

/** Planning horizon in years, clamped so degenerate persisted values can't explode the sims. */
export function planToAgeOf(settings: FireSettings): number {
  return clamp(settings.planToAge ?? 95, 80, 105);
}

/** Target Monte Carlo confidence in %, clamped to a sane band. */
export function targetConfidenceOf(settings: FireSettings): number {
  return clamp(settings.targetConfidence ?? 90, 50, 99);
}

/**
 * Pot outflows for one retired month. Spends cash, then ISA, then GIA (grossed
 * up for CGT), then — only once pension is accessible — the pension (grossed up
 * for income tax). State pension is treated as net of tax and just shrinks need.
 */
export function monthlyWithdrawals(
  age: number,
  pots: FirePots,
  p: DrawdownParams,
): MonthlyWithdrawal {
  const sp = age >= p.statePensionAge ? p.statePensionMonthly : 0;
  let need = Math.max(0, p.monthlySpend - sp);

  const cashAvail = Math.max(pots.cash, 0);
  const fromCash = Math.min(cashAvail, need);
  need -= fromCash;

  const isaAvail = Math.max(pots.isa, 0);
  const fromIsa = Math.min(isaAvail, need);
  need -= fromIsa;

  let fromGia = 0;
  const giaAvail = Math.max(pots.gia, 0);
  if (need > 0 && giaAvail > 0) {
    const netRate = 1 - p.giaCgtRate;
    // Gross-up so the *net* proceeds cover `need`. If the pot can't cover the
    // full gross, empty it and take whatever net remains.
    const grossNeeded = need / netRate;
    if (giaAvail >= grossNeeded) {
      fromGia = grossNeeded;
      need = 0;
    } else {
      fromGia = giaAvail;
      need -= giaAvail * netRate;
    }
  }

  let fromPension = 0;
  if (need > 0 && age >= p.pensionAccessAge) {
    // Remaining need comes from the pension, grossed up for tax. Caller detects
    // insolvency if this exceeds the pot (pension goes negative).
    fromPension = need / (1 - p.pensionTaxRate);
    need = 0;
  }

  return { fromCash, fromIsa, fromGia, fromPension, unmetNeed: need };
}

/** Sum of non-pension pot outflows (useful for table "accessible withdrawn"). */
export function accessibleWithdrawn(w: MonthlyWithdrawal): number {
  return w.fromCash + w.fromIsa + w.fromGia;
}
