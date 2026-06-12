import { createContext, useContext } from 'react';
import { formatCurrency, formatCurrencyShort } from '../utils';

interface CurrencyContextValue {
  currency: string;
  fmt: (value: number) => string;
  fmtShort: (value: number) => string;
}

export const CurrencyContext = createContext<CurrencyContextValue>({
  currency: 'GBP',
  fmt: (v) => formatCurrency(v, 'GBP'),
  fmtShort: (v) => formatCurrencyShort(v, 'GBP'),
});

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
