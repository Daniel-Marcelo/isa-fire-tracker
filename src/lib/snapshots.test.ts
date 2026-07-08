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
      currentSavings: 0,
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

describe('withTodaySnapshots', () => {
  it('upserts today\'s snapshot at units x price converted to GBP', () => {
    const holding: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = withTodaySnapshots(data, { AAA: 5 }, { GBP: 1 });
    const snapshot = result.providers[0].snapshots.find(s => s.date === todayKey());
    expect(snapshot?.totalValue).toBe(50);
  });

  it('returns the same object reference when the total is within 0.01 of the existing snapshot', () => {
    const holding: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding], { snapshots: [{ date: todayKey(), totalValue: 50.005 }] })]);
    const result = withTodaySnapshots(data, { AAA: 5 }, { GBP: 1 });
    expect(result).toBe(data);
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
