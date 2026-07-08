import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AppData, DividendRecord } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { convertAmount, type FxRates } from '../lib/fxRates';

interface Props {
  data: AppData;
  fxRates?: FxRates;
}

function IncomeTooltip({ active, payload, label, fmt }: { active?: boolean; payload?: { value: number }[]; label?: string; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl px-3 py-2 text-sm">
      <p className="font-medium text-slate-100">{label}</p>
      <p className="text-slate-400 mt-0.5">{fmt(payload[0].value)}</p>
    </div>
  );
}

export default function IncomeCard({ data, fxRates = {} }: Props) {
  const { fmt, fmtShort, currency: userCurrency } = useCurrency();
  const [showPayers, setShowPayers] = useState(false);

  const records: DividendRecord[] = useMemo(
    () => data.providers.flatMap(p => p.dividends ?? []),
    [data.providers],
  );

  const { ttm, byYear, byPayer } = useMemo(() => {
    const conv = (d: DividendRecord) => convertAmount(d.amount, d.currency, userCurrency, fxRates);
    // ISO dates compare lexicographically, so string >= is correct and avoids
    // timezone-shifted Date parsing.
    const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

    let ttm = 0;
    const yearMap = new Map<string, number>();
    const payerMap = new Map<string, { name: string; ttm: number; total: number }>();

    for (const d of records) {
      const value = conv(d);
      const year = d.date.slice(0, 4);
      yearMap.set(year, (yearMap.get(year) ?? 0) + value);
      const payer = payerMap.get(d.ticker) ?? { name: d.name ?? d.ticker, ttm: 0, total: 0 };
      payer.total += value;
      if (d.date >= cutoff) {
        ttm += value;
        payer.ttm += value;
      }
      payerMap.set(d.ticker, payer);
    }

    const byYear = Array.from(yearMap.entries())
      .map(([year, value]) => ({ year, value }))
      .sort((a, b) => a.year.localeCompare(b.year));
    const byPayer = Array.from(payerMap.entries())
      .map(([ticker, v]) => ({ ticker, ...v }))
      .sort((a, b) => b.ttm - a.ttm || b.total - a.total);

    return { ttm, byYear, byPayer };
  }, [records, userCurrency, fxRates]);

  if (records.length === 0) return null;

  const totalCostBasis = data.providers.reduce(
    (sum, p) => sum + p.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0),
    0,
  );
  const yieldOnCost = totalCostBasis > 0 ? (ttm / totalCostBasis) * 100 : null;

  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-100">Dividend income</h3>
          <p className="text-xs text-slate-600 mt-0.5">Net of withholding · converted at current FX rates</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-400 tabular-nums">{fmt(ttm)}</p>
          <p className="text-xs text-slate-500">
            last 12 months{yieldOnCost != null ? ` · ${yieldOnCost.toFixed(2)}% yield on cost` : ''}
          </p>
        </div>
      </div>

      {byYear.length > 0 && (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={byYear} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={fmtShort} width={64} axisLine={false} tickLine={false} />
              <Tooltip content={<IncomeTooltip fmt={fmt} />} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="value" fill="#4ade80" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <button
        onClick={() => setShowPayers(v => !v)}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
      >
        {showPayers ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        By holding
      </button>
      {showPayers && (
        <div className="mt-2 divide-y divide-slate-700/30">
          {byPayer.slice(0, 15).map(p => (
            <div key={p.ticker} className="flex items-center justify-between py-2 text-sm">
              <div className="min-w-0 pr-3">
                <p className="text-slate-200 truncate">{p.name}</p>
                <p className="text-xs text-slate-500 font-mono">{p.ticker}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-slate-200 tabular-nums">{fmt(p.ttm)}</p>
                <p className="text-xs text-slate-600 tabular-nums">{fmt(p.total)} all time</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
