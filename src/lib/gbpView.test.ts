import { describe, it, expect } from 'vitest';
import { applyLivePrices } from './applyLivePrices';
import { toGbpView } from './gbpView';
import type { AppData, Holding, Provider } from '../types';
import type { FxRates } from './fxRates';

function makeData(holdings: Holding[], currency: string): AppData {
  const provider: Provider = { id: 'p1', name: 'P', color: '#000', holdings, snapshots: [] };
  return {
    providers: [provider],
    taxYear: 2026,
    contributions: [],
    fireSettings: {
      currentAge: 40,
      targetRetirementAge: 55,
      monthlyContribution: 1000,
      monthlyPensionContribution: 500,
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

const RATES: FxRates = { GBP: 1, USD: 1.25 };
const total = (d: AppData) => d.providers[0].holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);

describe('GBP view for the FIRE tab', () => {
  const holdings: Holding[] = [
    { id: 'h1', name: 'US fund', ticker: 'USF', units: 10, costBasis: 1000, currency: 'USD' },
    { id: 'h2', name: 'UK cash', manualValue: 500, currency: 'GBP' },
  ];
  const prices = { USF: 125 };
  const ccys = { USF: 'USD' };

  it('is identical whichever display currency the user has selected', () => {
    const fromGbpUser = toGbpView(makeData(holdings, 'GBP'), prices, RATES, ccys);
    const fromUsdUser = toGbpView(makeData(holdings, 'USD'), prices, RATES, ccys);
    // The invariant this whole change buys: the FIRE engine's inputs cannot move
    // just because someone switched the display currency.
    expect(total(fromUsdUser)).toBeCloseTo(total(fromGbpUser), 8);
  });

  it('values a USD holding in GBP at the given rate', () => {
    const view = toGbpView(makeData(holdings, 'USD'), prices, RATES, ccys);
    // 10 units x $125 = $1250 -> £1000 at 1.25, plus £500 cash.
    expect(total(view)).toBeCloseTo(1500, 8);
  });

  it('converts cost basis exactly once', () => {
    const view = toGbpView(makeData(holdings, 'USD'), prices, RATES, ccys);
    expect(view.providers[0].holdings[0].costBasis).toBeCloseTo(800, 8); // $1000 / 1.25
  });

  it('leaves fireSettings untouched — they are stored in GBP and must not be converted', () => {
    const view = toGbpView(makeData(holdings, 'USD'), prices, RATES, ccys);
    expect(view.fireSettings.annualExpensesInRetirement).toBe(25000);
    expect(view.fireSettings.monthlyContribution).toBe(1000);
    expect(view.fireSettings.monthlyPensionContribution).toBe(500);
  });

  it('does not mutate the source data', () => {
    const base = makeData(holdings, 'USD');
    toGbpView(base, prices, RATES, ccys);
    expect(base.userSettings.currency).toBe('USD');
    expect(base.providers[0].holdings[0].currentValue).toBeUndefined();
  });

  it('still values GBP-only portfolios the same as the display view', () => {
    const gbpOnly: Holding[] = [{ id: 'h1', name: 'Cash', manualValue: 250, currency: 'GBP' }];
    const view = toGbpView(makeData(gbpOnly, 'GBP'), {}, RATES);
    const display = applyLivePrices(makeData(gbpOnly, 'GBP'), {}, RATES, {});
    expect(total(view)).toBe(total(display));
  });
});
