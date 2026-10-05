import type { AppData } from '../types';
import { isPensionType } from '../utils';

export interface PortfolioSummary {
  total: number;
  cost: number;
  gain: number;
  gainPct: number;
  accessible: number;
  pension: number;
  hasAccounts: boolean;
}

export function portfolioSummary(data: AppData): PortfolioSummary {
  let total = 0;
  let cost = 0;
  let pension = 0;
  for (const provider of data.providers) {
    const value = provider.holdings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
    const basis = provider.holdings.reduce((sum, holding) => sum + (holding.costBasis ?? 0), 0);
    total += value;
    cost += basis;
    if (isPensionType(provider.accountType)) pension += value;
  }
  return {
    total,
    cost,
    gain: total - cost,
    gainPct: cost > 0 ? ((total - cost) / cost) * 100 : 0,
    accessible: total - pension,
    pension,
    hasAccounts: data.providers.length > 0,
  };
}
