import { describe, it, expect } from 'vitest';
import { applyLivePrices } from './applyLivePrices';
import { migrateAppData, stripDerived, defaultData } from '../store';
import type { AppData, Holding, Provider } from '../types';

// Mirrors the cleaning exportData() does before download, without touching the DOM —
// see store.ts exportData(), which this factors out for testability.
function exportShape(data: AppData): AppData {
  return {
    ...data,
    providers: data.providers.map(p => ({
      ...p,
      holdings: p.holdings.map(stripDerived),
    })),
  };
}

// Base fireSettings/userSettings on defaultData's full shape (rather than a hand-picked
// subset) so migrateAppData's default-merge is a true no-op — otherwise the round trip
// would legitimately gain keys that a hand-rolled fixture omitted, which is not the drift
// this test is trying to catch.
function makeData(providers: Provider[], currency = 'GBP'): AppData {
  return {
    providers,
    taxYear: 2025,
    contributions: [{ taxYear: 2025, amount: 5000 }],
    fireSettings: { ...defaultData.fireSettings, monthlyContribution: 500 },
    userSettings: { ...defaultData.userSettings, currency },
    targets: [],
  };
}

// A mix of a GBP ticker holding, a USD ticker holding (costBasis stored in USD), and a
// cash provider (manualValue, no ticker) — the shapes the money pipeline must round-trip
// and switch currency across without drift.
function buildMixedBase(): AppData {
  const gbpHolding: Holding = {
    id: 'h1', name: 'Vodafone', ticker: 'VOD', units: 100, currency: 'GBP', costBasis: 500,
    // Deliberately include runtime-derived fields, as if this object were saved straight
    // out of applyLivePrices' output by mistake — the round trip must strip them.
    currentPrice: 5.5, currentValue: 550,
  };
  const usdHolding: Holding = {
    id: 'h2', name: 'Apple', ticker: 'AAPL', units: 10, currency: 'USD', costBasis: 1000,
  };
  const cashHolding: Holding = {
    id: 'h3', name: 'Cash', manualValue: 2000, currency: 'GBP',
  };

  // dividends: [] is included explicitly (rather than left absent) because
  // migrateAppData always fills in `dividends ?? []` — a fixture that left it absent
  // would gain a key on the round trip that isn't drift, just an unfilled default.
  const isaProvider: Provider = { id: 'p1', name: 'ISA', color: '#111', holdings: [gbpHolding], snapshots: [], dividends: [] };
  const brokerProvider: Provider = { id: 'p2', name: 'Broker', color: '#222', holdings: [usdHolding], snapshots: [], dividends: [] };
  const savingsProvider: Provider = { id: 'p3', name: 'Savings', color: '#333', holdings: [cashHolding], snapshots: [], dividends: [] };

  return makeData([isaProvider, brokerProvider, savingsProvider]);
}

describe('currency round trip', () => {
  it('export -> JSON round trip -> migrateAppData equals the stripped original, with no derived keys leaking', () => {
    const data = buildMixedBase();
    const expected = exportShape(data);

    const roundTripped = migrateAppData(JSON.parse(JSON.stringify(exportShape(data))));

    expect(roundTripped).toEqual(expected);
    for (const p of roundTripped.providers) {
      for (const h of p.holdings) {
        expect('currentPrice' in h).toBe(false);
        expect('currentValue' in h).toBe(false);
      }
    }
  });

  // Highest-value invariant: applyLivePrices must always be applied to the raw baseData,
  // never to already-derived output (App.tsx's baseData.current pattern). We convert from
  // the same raw base each time — feeding one applyLivePrices output into the next would
  // be exactly the double-conversion bug class this test exists to catch.
  it('currency-switch idempotence: GBP -> USD -> GBP leaves costBasis/currentValue unchanged', () => {
    const rawBase = buildMixedBase();
    const prices = { VOD: 5.5, AAPL: 250 };
    const rates = { GBP: 1, USD: 1.25 };

    const asGbp = (currency: string) => applyLivePrices({ ...rawBase, userSettings: { currency } }, prices, rates);

    const gbp1 = asGbp('GBP');
    const usd = asGbp('USD'); // not fed back into the next call — always from rawBase
    const gbp2 = asGbp('GBP');

    // Sanity: the USD pass actually produced different numbers (otherwise this test
    // would pass vacuously without exercising any conversion).
    expect(usd.providers[0].holdings[0].currentValue).not.toBeCloseTo(gbp1.providers[0].holdings[0].currentValue!, 2);

    for (let pi = 0; pi < gbp1.providers.length; pi++) {
      for (let hi = 0; hi < gbp1.providers[pi].holdings.length; hi++) {
        const a = gbp1.providers[pi].holdings[hi];
        const b = gbp2.providers[pi].holdings[hi];
        if (a.costBasis != null) expect(b.costBasis).toBeCloseTo(a.costBasis, 2);
        if (a.currentValue != null) expect(b.currentValue).toBeCloseTo(a.currentValue, 2);
      }
    }
  });
});
