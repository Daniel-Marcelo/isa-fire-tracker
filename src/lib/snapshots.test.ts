import { describe, it, expect } from 'vitest';
import { withTodaySnapshots, providerGbpTotal, todayKey } from './snapshots';
import type { AppData, Holding, Provider } from '../types';

function makeProvider(holdings: Holding[], overrides: Partial<Provider> = {}): Provider {
  return { id: 'p1', name: 'Provider', color: '#000', holdings, snapshots: [], ...overrides };
}

function makeData(providers: Provider[]): AppData {
  return {
    providers,
    taxYear: 2025,
    contributions: [],
    fireSettings: {
      currentAge: 30,
      targetRetirementAge: 55,
      monthlyContribution: 0,
      monthlyPensionContribution: 0,
      pensionAccessAge: 57,
      expectedAnnualReturn: 7,
      inflationRate: 3,
      annualExpensesInRetirement: 25000,
      withdrawalRate: 3.5,
    },
    userSettings: { currency: 'GBP' },
    targets: [],
  };
}

// Ticker'd holdings now need a price age too — a price that can't be dated, or is
// older than PRICE_SNAPSHOT_MAX_AGE_MS, must not be written into permanent history.
const NOW = Date.parse('2026-07-29T12:00:00Z');
const FRESH = NOW - 60 * 60 * 1000;        // 1 hour old
const STALE = NOW - 72 * 60 * 60 * 1000;   // 72 hours old

describe('withTodaySnapshots', () => {
  it('upserts today\'s snapshot at units x price converted to GBP', () => {
    const holding: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = withTodaySnapshots(data, { AAA: 5 }, { GBP: 1 }, { AAA: FRESH }, NOW);
    const snapshot = result.providers[0].snapshots.find(s => s.date === todayKey());
    expect(snapshot?.totalValue).toBe(50);
  });

  it('returns the same object reference when the total is within 0.01 of the existing snapshot', () => {
    const holding: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding], { snapshots: [{ date: todayKey(), totalValue: 50.005 }] })]);
    const result = withTodaySnapshots(data, { AAA: 5 }, { GBP: 1 }, { AAA: FRESH }, NOW);
    expect(result).toBe(data);
  });

  it('writes no snapshot when the price is stale, even though the price itself is present', () => {
    const holding: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = withTodaySnapshots(data, { AAA: 5 }, { GBP: 1 }, { AAA: STALE }, NOW);
    // Reference equality is load-bearing: App.tsx compares snapped !== base to
    // decide whether to save, so a stale refresh must not trigger a write.
    expect(result).toBe(data);
    expect(result.providers[0].snapshots).toHaveLength(0);
  });

  it('skips a provider when a ticker\'d holding lacks a live price', () => {
    const holding: Holding = { id: 'h1', name: 'B', ticker: 'BBB', units: 5 };
    const data = makeData([makeProvider([holding])]);
    const result = withTodaySnapshots(data, {}, { GBP: 1 });
    expect(result).toBe(data);
    expect(result.providers[0].snapshots).toHaveLength(0);
  });

  it('skips a provider when a holding currency has no fx rate', () => {
    const holding: Holding = { id: 'h1', name: 'C', manualValue: 100, currency: 'USD' };
    const data = makeData([makeProvider([holding])]);
    const result = withTodaySnapshots(data, {}, { GBP: 1 });
    expect(result).toBe(data);
    expect(result.providers[0].snapshots).toHaveLength(0);
  });

  it('preserves existing other-day snapshots and keeps the list sorted', () => {
    const holding: Holding = { id: 'h1', name: 'D', manualValue: 30, currency: 'GBP' };
    const data = makeData([makeProvider([holding], {
      snapshots: [
        { date: '2026-07-05', totalValue: 20 },
        { date: '2026-07-01', totalValue: 10 },
      ],
    })]);
    const result = withTodaySnapshots(data, {}, { GBP: 1 });
    const dates = result.providers[0].snapshots.map(s => s.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates).toContain('2026-07-01');
    expect(dates).toContain('2026-07-05');
    expect(dates).toContain(todayKey());
  });
});

describe('providerGbpTotal — currency conversion and trust rules (money-pipeline regression)', () => {
  it('converts a USD holding to GBP using fxRates', () => {
    const holding: Holding = { id: 'h1', name: 'A', manualValue: 125, currency: 'USD' };
    const provider = makeProvider([holding]);
    const total = providerGbpTotal(provider, {}, { GBP: 1, USD: 1.25 });
    expect(total).toBeCloseTo(100, 8); // 125 / 1.25
  });

  it('returns null when a ticker\'d holding with units has no live price (pinned so the rank-3 fix does not weaken this guarantee)', () => {
    const holding: Holding = { id: 'h1', name: 'B', ticker: 'BBB', units: 5, currency: 'GBP' };
    const provider = makeProvider([holding]);
    const total = providerGbpTotal(provider, {}, { GBP: 1 });
    expect(total).toBeNull();
  });

  it('returns null when a non-GBP holding\'s currency is absent from fxRates', () => {
    const holding: Holding = { id: 'h1', name: 'C', manualValue: 100, currency: 'JPY' };
    const provider = makeProvider([holding]);
    const total = providerGbpTotal(provider, {}, { GBP: 1, USD: 1.25 });
    expect(total).toBeNull();
  });
});

describe('providerGbpTotal — price staleness', () => {
  const ticker: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };

  it('values the provider when the price is an hour old', () => {
    const total = providerGbpTotal(makeProvider([ticker]), { AAA: 5 }, { GBP: 1 }, { AAA: FRESH }, NOW);
    expect(total).toBe(50);
  });

  it('returns null when the price is 72 hours old', () => {
    const total = providerGbpTotal(makeProvider([ticker]), { AAA: 5 }, { GBP: 1 }, { AAA: STALE }, NOW);
    expect(total).toBeNull();
  });

  it('accepts a price just inside the 48h cutoff and rejects one just outside', () => {
    const inside = NOW - (48 * 60 * 60 * 1000) + 1000;
    const outside = NOW - (48 * 60 * 60 * 1000) - 1000;
    expect(providerGbpTotal(makeProvider([ticker]), { AAA: 5 }, { GBP: 1 }, { AAA: inside }, NOW)).toBe(50);
    expect(providerGbpTotal(makeProvider([ticker]), { AAA: 5 }, { GBP: 1 }, { AAA: outside }, NOW)).toBeNull();
  });

  it('treats an undateable price as stale — history is permanent, so we only record what we can vouch for', () => {
    expect(providerGbpTotal(makeProvider([ticker]), { AAA: 5 }, { GBP: 1 }, { AAA: null }, NOW)).toBeNull();
    expect(providerGbpTotal(makeProvider([ticker]), { AAA: 5 }, { GBP: 1 }, {}, NOW)).toBeNull();
  });

  it('does not block cash / manual-value holdings, which the feed never prices', () => {
    const cash: Holding = { id: 'h2', name: 'Savings', manualValue: 250, currency: 'GBP' };
    const total = providerGbpTotal(makeProvider([cash]), {}, { GBP: 1 }, {}, NOW);
    expect(total).toBe(250);
  });

  it('rejects the whole provider when only one of several holdings is stale', () => {
    const cash: Holding = { id: 'h2', name: 'Savings', manualValue: 250, currency: 'GBP' };
    const total = providerGbpTotal(makeProvider([cash, ticker]), { AAA: 5 }, { GBP: 1 }, { AAA: STALE }, NOW);
    expect(total).toBeNull();
  });
});

describe('providerGbpTotal — legacy GBp currency code', () => {
  // providerGbpTotal checks `holding.currency` directly against fxRates without
  // running it through convertAmount's pence-normalisation (which maps 'GBp' -> 'GBP').
  // So a holding whose currency is literally the legacy 'GBp' code is treated as an
  // unrecognised foreign currency here: 'GBp' !== 'GBP' and fxRates has no 'GBp' key,
  // so the whole provider is (silently) skipped. This is documented current behaviour,
  // not "fixed" — see PLAN-snapshot-accuracy.
  it('returns null when a holding currency key ("GBp") is absent from fxRates', () => {
    const holding: Holding = { id: 'h1', name: 'E', manualValue: 100, currency: 'GBp' };
    const provider = makeProvider([holding]);
    const total = providerGbpTotal(provider, {}, { GBP: 1 });
    expect(total).toBeNull();
  });
});
