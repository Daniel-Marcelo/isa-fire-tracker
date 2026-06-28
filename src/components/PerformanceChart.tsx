import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Provider } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { convertAmount, type FxRates } from '../lib/fxRates';

interface Props {
  providers: Provider[];
  fxRates?: FxRates;
}

export default function PerformanceChart({ providers, fxRates = {} }: Props) {
  const { fmtShort, currency } = useCurrency();
  const data = useMemo(() => {
    // Collect all unique dates across all providers
    const dateSet = new Set<string>();
    providers.forEach(p => p.snapshots.forEach(s => dateSet.add(s.date)));
    const dates = Array.from(dateSet).sort();

    return dates.map(date => {
      const point: Record<string, string | number> = { date };
      let total = 0;
      providers.forEach(p => {
        // Find most recent snapshot at or before this date
        const snap = [...p.snapshots].filter(s => s.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
        if (snap) {
          // Snapshots are stored in GBP; convert to display currency
          const converted = convertAmount(snap.totalValue, 'GBP', currency, fxRates);
          point[p.id] = converted;
          total += converted;
        }
      });
      point['Total'] = total;
      return point;
    });
  }, [providers, currency, fxRates]);

  if (data.length < 2) return null;

  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
      <h3 className="font-semibold text-slate-100 mb-4">Portfolio Performance</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={d => d.slice(5)} />
          <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={fmtShort} width={70} />
          <Tooltip
            formatter={(v) => fmtShort(Number(v))}
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', color: '#f8fafc', fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend />
          <Line dataKey="Total" stroke="#6366f1" strokeWidth={2} dot={false} />
          {providers.map(p => (
            <Line key={p.id} dataKey={p.id} name={p.name} stroke={p.color} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
