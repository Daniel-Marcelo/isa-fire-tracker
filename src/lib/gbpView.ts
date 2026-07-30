import type { AppData } from '../types';
import { applyLivePrices } from './applyLivePrices';
import type { FxRates } from './fxRates';

/**
 * Value a portfolio in GBP regardless of the user's display currency.
 *
 * The FIRE tab runs on this. Its inputs — retirement spending, monthly
 * contributions, state pension, drawdown tax — are inherently sterling, so
 * feeding it display-converted pots would draw a $-denominated pot down by
 * £-denominated spending and move the headline FIRE age by the exchange rate.
 *
 * Built from raw data with the target currency pinned, never by converting an
 * already-converted display copy: that round trip is the double-conversion bug
 * currencyRoundTrip.test.ts exists to catch.
 */
export function toGbpView(
  base: AppData,
  prices: Record<string, number>,
  rates: FxRates,
  priceCurrencies: Record<string, string> = {},
): AppData {
  return applyLivePrices(
    { ...base, userSettings: { ...base.userSettings, currency: 'GBP' } },
    prices,
    rates,
    priceCurrencies,
  );
}
