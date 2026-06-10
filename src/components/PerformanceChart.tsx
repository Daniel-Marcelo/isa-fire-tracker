import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Provider } from '../types';
import { formatCurrencyShort } from '../utils';

interface Props {
  providers: Provider[];
}

export default function PerformanceChart({ providers }: Props) {
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
          point[p.name] = snap.totalValue;
          total += snap.totalValue;
        }
      });
      point['Total'] = total;
      return point;
    });
  }, [providers]);

  if (data.length < 2) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <h3 className="font-semibold text-gray-900 mb-4">Portfolio Performance</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={d => d.slice(5)} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={formatCurrencyShort} width={70} />
          <Tooltip formatter={(v) => formatCurrencyShort(Number(v))} />
          <Legend />
          <Line dataKey="Total" stroke="#6366f1" strokeWidth={2} dot={false} />
          {providers.map(p => (
            <Line key={p.id} dataKey={p.name} stroke={p.color} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
