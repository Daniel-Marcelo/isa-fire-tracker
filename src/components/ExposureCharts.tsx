import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { AppData, FundHolding, UploadedFundHoldings } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { isCashType } from '../utils';

interface Props {
  data: AppData;
  fundHoldings: UploadedFundHoldings[];
}

const SECTOR_COLOURS: Record<string, string> = {
  Technology:    '#6366f1',
  Financials:    '#10b981',
  Healthcare:    '#f43f5e',
  Consumer:      '#f59e0b',
  Energy:        '#f97316',
  Industrials:   '#06b6d4',
  Materials:     '#84cc16',
  Telecom:       '#8b5cf6',
  'Real Estate': '#0ea5e9',
  Utilities:     '#14b8a6',
  Other:         '#94a3b8',
};

const REGION_COLOURS: Record<string, string> = {
  US: '#6366f1', TW: '#3b82f6', CN: '#ef4444', HK: '#ec4899',
  IN: '#f97316', KR: '#8b5cf6', JP: '#06b6d4', GB: '#10b981',
  BR: '#84cc16', SA: '#f59e0b', ZA: '#14b8a6', Other: '#94a3b8',
};

function matchesFund(h: { ticker?: string; name: string }, fundId: string) {
  return h.ticker?.toUpperCase() === fundId || h.name.toUpperCase().includes(fundId);
}

function CustomTooltip({ active, payload, fmt }: { active?: boolean; payload?: { name: string; value: number; payload: { pct: number } }[]; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const { name, value, payload: inner } = payload[0];
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl px-3 py-2 text-sm">
      <p className="font-medium text-slate-100">{name}</p>
      <p className="text-slate-400 mt-0.5">{fmt(value)} · {inner.pct.toFixed(1)}%</p>
    </div>
  );
}

export default function ExposureCharts({ data, fundHoldings }: Props) {
  const { fmt } = useCurrency();

  const fundRegistry = fundHoldings.map(u => ({
    id: u.fundTicker.toUpperCase(),
    holdings: u.holdings as FundHolding[],
  }));

  const allHoldings = data.providers.filter(p => !isCashType(p.accountType)).flatMap(p => p.holdings);
  const isFundHolding = (h: { ticker?: string; name: string }) =>
    fundRegistry.some(f => matchesFund(h, f.id));
  const directHoldings = allHoldings.filter(h => !isFundHolding(h) && h.ticker);

  // Aggregate sector and country exposure across all funds + direct holdings
  const sectorMap = new Map<string, number>();
  const countryMap = new Map<string, number>();

  fundRegistry.forEach(fund => {
    const userHoldings = allHoldings.filter(h => matchesFund(h, fund.id));
    const total = userHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
    if (total === 0) return;
    fund.holdings.forEach(fh => {
      if (fh.ticker === 'OTHER') return;
      const contribution = total * (fh.weight / 100);
      sectorMap.set(fh.sector, (sectorMap.get(fh.sector) ?? 0) + contribution);
      const country = fh.country || 'Other';
      countryMap.set(country, (countryMap.get(country) ?? 0) + contribution);
    });
  });

  directHoldings.forEach(h => {
    sectorMap.set('Direct', (sectorMap.get('Direct') ?? 0) + (h.currentValue ?? 0));
    countryMap.set('US', (countryMap.get('US') ?? 0) + (h.currentValue ?? 0));
  });

  const total = Array.from(sectorMap.values()).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const sectorData = Array.from(sectorMap.entries())
    .map(([name, value]) => ({ name, value, pct: (value / total) * 100, fill: SECTOR_COLOURS[name] ?? '#94a3b8' }))
    .sort((a, b) => b.value - a.value);

  // Group small countries into "Other"
  const sortedCountries = Array.from(countryMap.entries()).sort((a, b) => b[1] - a[1]);
  const topCountries = sortedCountries.slice(0, 9);
  const otherCountryValue = sortedCountries.slice(9).reduce((s, [, v]) => s + v, 0);
  const countryData = [
    ...topCountries.map(([name, value]) => ({ name, value, pct: (value / total) * 100, fill: REGION_COLOURS[name] ?? '#94a3b8' })),
    ...(otherCountryValue > 0 ? [{ name: 'Other', value: otherCountryValue, pct: (otherCountryValue / total) * 100, fill: '#94a3b8' }] : []),
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <DonutChart title="Sector exposure" data={sectorData} fmt={fmt} />
      <DonutChart title="Geographic exposure" data={countryData} fmt={fmt} />
    </div>
  );
}

function DonutChart({ title, data, fmt }: { title: string; data: { name: string; value: number; pct: number; fill: string }[]; fmt: (v: number) => string }) {
  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
      <p className="text-sm font-semibold text-slate-300 mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.fill} stroke="#0f172a" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip fmt={fmt} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span className="text-xs text-slate-500">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
