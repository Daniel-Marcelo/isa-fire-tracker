import type { AppData } from '../types';
import { convertAmount, type FxRates } from './fxRates';

export function applyLivePrices(base: AppData, prices: Record<string, number>, rates: FxRates): AppData {
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

        if (livePrice !== undefined) {
          const currentPrice = conv(livePrice, hCurrency);
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
