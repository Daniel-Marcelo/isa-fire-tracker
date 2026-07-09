import type { AppData } from '../types';
import { convertAmount, type FxRates } from './fxRates';

export function applyLivePrices(
  base: AppData,
  prices: Record<string, number>,
  rates: FxRates,
  priceCurrencies: Record<string, string> = {},
): AppData {
  const userCurrency = base.userSettings?.currency ?? 'GBP';

  function conv(amount: number, from: string) {
    return convertAmount(amount, from, userCurrency, rates);
  }

  return {
    ...base,
    providers: base.providers.map(provider => ({
      ...provider,
      holdings: provider.holdings.map(holding => {
        const hCurrency = holding.currency ?? 'GBP';
        const livePrice = holding.ticker ? prices[holding.ticker] : undefined;
        const costBasis = holding.costBasis != null ? conv(holding.costBasis, hCurrency) : undefined;
        // The live price's own currency comes from the feed, not the holding — this
        // makes even CSV-imported holdings (which may be mistagged/defaulted) render
        // correctly. Cost basis still always uses the holding's own currency.
        const priceCcy = holding.ticker ? (priceCurrencies[holding.ticker] ?? hCurrency) : hCurrency;

        if (livePrice !== undefined) {
          const currentPrice = conv(livePrice, priceCcy);
          const currentValue = holding.units != null
            ? holding.units * currentPrice
            : conv(holding.manualValue ?? 0, hCurrency);
          return { ...holding, currentPrice, currentValue, ...(costBasis != null ? { costBasis } : {}) };
        }

        const currentValue = conv(holding.manualValue ?? 0, hCurrency);
        return { ...holding, currentPrice: undefined, currentValue, ...(costBasis != null ? { costBasis } : {}) };
      }),
    })),
  };
}
