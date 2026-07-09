import { describe, it, expect } from 'vitest';
import { applyLivePrices } from './applyLivePrices';
import type { AppData, Holding, Provider } from '../types';

function makeProvider(holdings: Holding[], overrides: Partial<Provider> = {}): Provider {
  return { id: 'p1', name: 'Provider', color: '#000', holdings, snapshots: [], ...overrides };
}

function makeData(providers: Provider[], currency = 'GBP'): AppData {
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
    userSettings: { currency },
    targets: [],
  };
}

describe('applyLivePrices', () => {
  it('values a ticker holding with units at units x converted price', () => {
    const holding: Holding = { id: 'h1', name: 'Apple', ticker: 'AAPL', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = applyLivePrices(data, { AAPL: 5 }, { GBP: 1 });
    const h = result.providers[0].holdings[0];
    expect(h.currentPrice).toBe(5);
    expect(h.currentValue).toBe(50);
  });

  it('falls back to converted manualValue when a live price exists but units is null', () => {
    const holding: Holding = { id: 'h1', name: 'Apple', ticker: 'AAPL', manualValue: 200, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = applyLivePrices(data, { AAPL: 5 }, { GBP: 1 });
    const h = result.providers[0].holdings[0];
    expect(h.currentValue).toBe(200);
  });

  it('with no live price, currentPrice is undefined and currentValue is converted manualValue', () => {
    const holding: Holding = { id: 'h1', name: 'Cash fund', manualValue: 150, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = applyLivePrices(data, {}, { GBP: 1 });
    const h = result.providers[0].holdings[0];
    expect(h.currentPrice).toBeUndefined();
    expect(h.currentValue).toBe(150);
  });

  it('converts costBasis from holding currency to user currency; a holding without costBasis gains no costBasis key', () => {
    const withCostBasis: Holding = { id: 'h1', name: 'A', manualValue: 100, currency: 'GBP', costBasis: 80 };
    const withoutCostBasis: Holding = { id: 'h2', name: 'B', manualValue: 100, currency: 'GBP' };
    const data = makeData([makeProvider([withCostBasis, withoutCostBasis])]);
    const result = applyLivePrices(data, {}, { GBP: 1 });
    expect(result.providers[0].holdings[0].costBasis).toBe(80);
    expect('costBasis' in result.providers[0].holdings[1]).toBe(false);
  });

  it('doubles values when user currency is USD, holding currency is GBP, rates { GBP: 1, USD: 2 }', () => {
    const holding: Holding = { id: 'h1', name: 'A', manualValue: 100, currency: 'GBP', costBasis: 50 };
    const data = makeData([makeProvider([holding])], 'USD');
    const result = applyLivePrices(data, {}, { GBP: 1, USD: 2 });
    const h = result.providers[0].holdings[0];
    expect(h.currentValue).toBe(200);
    expect(h.costBasis).toBe(100);
  });

  // Regression (PLAN-currency-price-integrity): live prices arrive already denominated
  // in pounds for GBP holdings — no /100 pence normalisation should happen here.
  // Pence normalisation (GBp -> GBP) is firebasePrices' job upstream; this contract
  // test implicitly covers it by asserting applyLivePrices does no such conversion itself.
  it('values a GBP holding at price 10.38 x 10 units = 103.8 (prices already in pounds)', () => {
    const holding: Holding = { id: 'h1', name: 'A', ticker: 'AAA', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = applyLivePrices(data, { AAA: 10.38 }, { GBP: 1 });
    expect(result.providers[0].holdings[0].currentValue).toBeCloseTo(103.8, 8);
  });

  // Regression (PLAN-08-07-round-csv-import-currency): a CSV-imported holding may be
  // mistagged/defaulted to GBP while its live price actually arrives in USD. The price
  // currency must come from the feed (priceCurrencies), not the holding's own currency.
  it('uses the feed price currency, not the holding currency, to convert a live price', () => {
    const holding: Holding = { id: 'h1', name: 'Apple', ticker: 'AAPL', units: 10, currency: 'GBP' };
    const data = makeData([makeProvider([holding])]);
    const result = applyLivePrices(
      data,
      { AAPL: 250 },
      { GBP: 1, USD: 1.25 },
      { AAPL: 'USD' },
    );
    const h = result.providers[0].holdings[0];
    expect(h.currentPrice).toBeCloseTo(250 / 1.25, 8);
    expect(h.currentValue).toBeCloseTo(10 * (250 / 1.25), 8);
  });

  it('defaults priceCurrencies to {} so existing callers/tests are unaffected', () => {
    const holding: Holding = { id: 'h1', name: 'Apple', ticker: 'AAPL', units: 10, currency: 'USD' };
    const data = makeData([makeProvider([holding])], 'USD');
    const result = applyLivePrices(data, { AAPL: 250 }, { GBP: 1, USD: 1.25 });
    expect(result.providers[0].holdings[0].currentPrice).toBe(250);
  });
});
