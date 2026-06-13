import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { AppData } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { PROVIDER_COLORS } from '../utils';

interface Props {
  data: AppData;
}

const ACCOUNT_TYPE_COLOURS: Record<string, string> = {
  'ISA':                '#6366f1',
  'SIPP':               '#10b981',
  'GIA':                '#f59e0b',
  'Workplace Pension':  '#3b82f6',
  'Other':              '#94a3b8',
};

const OWNER_COLOURS: Record<string, string> = {
  'Daniel':  '#6366f1',
  'Camilla': '#ec4899',
};

function CustomTooltip({ active, payload, fmt }: { active?: boolean; payload?: { name: string; value: number }[]; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-gray-800">{payload[0].name}</p>
      <p className="text-gray-600 mt-0.5">{fmt(payload[0].value)}</p>
    </div>
  );
}

export default function AllocationCharts({ data }: Props) {
  const { fmt } = useCurrency();

  const nameCounts = data.providers.reduce<Record<string, number>>((acc, p) => {
    acc[p.name] = (acc[p.name] ?? 0) + 1;
    return acc;
  }, {});

  const providerData = data.providers
    .map(p => ({
      name: nameCounts[p.name] > 1 && p.accountType ? `${p.name} (${p.accountType})` : p.name,
      value: p.holdings.reduce((s, h) => s + h.currentValue, 0),
      color: p.color || PROVIDER_COLORS[0],
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const accountTypeData = Object.entries(
    data.providers.reduce<Record<string, number>>((acc, p) => {
      const type = p.accountType ?? 'Other';
      const val = p.holdings.reduce((s, h) => s + h.currentValue, 0);
      acc[type] = (acc[type] ?? 0) + val;
      return acc;
    }, {})
  )
    .map(([name, value]) => ({ name, value, color: ACCOUNT_TYPE_COLOURS[name] ?? '#94a3b8' }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const ownerData = Object.entries(
    data.providers.reduce<Record<string, number>>((acc, p) => {
      const owner = p.owner ?? 'Other';
      const val = p.holdings.reduce((s, h) => s + h.currentValue, 0);
      acc[owner] = (acc[owner] ?? 0) + val;
      return acc;
    }, {})
  )
    .map(([name, value]) => ({ name, value, color: OWNER_COLOURS[name] ?? '#94a3b8' }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const showOwner = ownerData.length > 1;

  if (providerData.length === 0) return null;

  return (
    <div className={`grid gap-4 ${showOwner ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
      <Chart title="By Provider" data={providerData} fmt={fmt} />
      <Chart title="By Account Type" data={accountTypeData} fmt={fmt} />
      {showOwner && <Chart title="By Owner" data={ownerData} fmt={fmt} />}
    </div>
  );
}

function Chart({ title, data, fmt }: { title: string; data: { name: string; value: number; color: string }[]; fmt: (v: number) => string }) {
  const barHeight = 40;
  const chartHeight = Math.max(data.length * barHeight + 16, 80);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="25%"
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={90}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip fmt={fmt} />} cursor={{ fill: '#f9fafb' }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
