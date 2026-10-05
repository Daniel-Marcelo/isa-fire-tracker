import type { AppData, Holding } from '../types';
import { uid } from '../utils';
import type { ParsedImport } from '../lib/csvParsers';

export function applyCsvImport(data: AppData, providerId: string, parsed: ParsedImport, mergeMode: 'replace' | 'merge'): AppData {
  return {
    ...data,
    providers: data.providers.map(p => {
      if (p.id !== providerId) return p;
      let holdings: Holding[];
      if (mergeMode === 'replace') {
        holdings = parsed.holdings.map(ph => ({
          id: uid(),
          name: ph.name,
          ticker: ph.ticker,
          units: ph.units,
          manualValue: ph.costBasis,
          costBasis: ph.costBasis,
          currency: ph.currency,
        }));
      } else {
        const existing = [...p.holdings];
        for (const ph of parsed.holdings) {
          const match = existing.find(h => h.ticker?.toUpperCase() === ph.ticker.toUpperCase());
          if (match) {
            match.units = (match.units ?? 0) + ph.units;
            match.costBasis = (match.costBasis ?? 0) + ph.costBasis;
            match.manualValue = (match.manualValue ?? 0) + ph.costBasis;
          } else {
            existing.push({
              id: uid(),
              name: ph.name,
              ticker: ph.ticker,
              units: ph.units,
              manualValue: ph.costBasis,
              costBasis: ph.costBasis,
              currency: ph.currency,
            });
          }
        }
        holdings = existing;
      }
      let dividends;
      if (mergeMode === 'replace') {
        dividends = parsed.dividends;
      } else {
        const seen = new Set((p.dividends ?? []).map(d => d.id));
        dividends = [...(p.dividends ?? []), ...parsed.dividends.filter(d => !seen.has(d.id))];
      }
      dividends = [...dividends].sort((a, b) => a.date.localeCompare(b.date));
      return { ...p, holdings, dividends, lastCsvImport: new Date().toISOString() };
    }),
  };
}
