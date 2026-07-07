import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

const BROKER_PATTERNS: { canonical: string; patterns: string[] }[] = [
  { canonical: 'Vanguard',             patterns: ['vanguard'] },
  { canonical: 'Trading 212',          patterns: ['trading 212', 't212', 't 212'] },
  { canonical: 'Freetrade',            patterns: ['freetrade'] },
  { canonical: 'Hargreaves Lansdown',  patterns: ['hargreaves', 'lansdown', 'h.l.', '\\bhl\\b'] },
  { canonical: 'AJ Bell',              patterns: ['aj bell', 'ajbell', 'youinvest'] },
  { canonical: 'Interactive Investor', patterns: ['interactive investor', '\\bii\\b'] },
  { canonical: 'iWeb',                 patterns: ['iweb', 'i-web'] },
  { canonical: 'Nutmeg',               patterns: ['nutmeg'] },
  { canonical: 'Moneybox',             patterns: ['moneybox', 'money box'] },
  { canonical: 'Bestinvest',           patterns: ['bestinvest', 'best invest'] },
  { canonical: 'Charles Stanley',      patterns: ['charles stanley'] },
  { canonical: 'Fidelity',             patterns: ['fidelity'] },
  { canonical: 'HSBC',                 patterns: ['hsbc'] },
  { canonical: 'Barclays',             patterns: ['barclays'] },
  { canonical: 'Aviva',                patterns: ['aviva'] },
  { canonical: 'Legal & General',      patterns: ['legal & general', 'legal and general', 'l&g', 'l & g'] },
  { canonical: 'Scottish Widows',      patterns: ['scottish widows'] },
  { canonical: 'Royal London',         patterns: ['royal london'] },
  { canonical: 'Nest',                 patterns: ['\\bnest\\b'] },
  { canonical: 'PensionBee',           patterns: ['pensionbee', 'pension bee'] },
  { canonical: 'Revolut',              patterns: ['revolut'] },
  { canonical: 'InvestEngine',         patterns: ['investengine', 'invest engine'] },
  { canonical: 'Plum',                 patterns: ['\\bplum\\b'] },
  { canonical: 'Chip',                 patterns: ['\\bchip\\b'] },
  { canonical: 'eToro',                patterns: ['etoro', 'e-toro'] },
  { canonical: 'Moneyfarm',            patterns: ['moneyfarm'] },
  { canonical: 'Wealthify',            patterns: ['wealthify'] },
  { canonical: 'Wealthsimple',         patterns: ['wealthsimple'] },
  { canonical: 'Lightyear',            patterns: ['lightyear'] },
  { canonical: 'Dodl',                 patterns: ['dodl'] },
  { canonical: 'Saxo',                 patterns: ['saxo'] },
  { canonical: 'InvestDirect',         patterns: ['investdirect', 'invest direct'] },
  { canonical: 'Willis Owen',          patterns: ['willis owen'] },
  { canonical: 'Cavendish',            patterns: ['cavendish'] },
];

function canonicalBroker(name: string): string {
  const lower = name.toLowerCase();
  for (const { canonical, patterns } of BROKER_PATTERNS) {
    if (patterns.some(p => new RegExp(p, 'i').test(lower))) return canonical;
  }
  return name;
}

function CustomTooltip({ active, payload, fmt }: { active?: boolean; payload?: { name: string; value: number }[]; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl px-3 py-2 text-sm">
      <p className="font-medium text-slate-100">{payload[0].name}</p>
      <p className="text-slate-400 mt-0.5">{fmt(payload[0].value)}</p>
    </div>
  );
}

export default function AllocationCharts({ data }: Props) {
  const { fmt } = useCurrency();

  const providerData = Object.values(
    data.providers.reduce<Record<string, { name: string; value: number; color: string; _entries: { value: number; color: string }[] }>>((acc, p) => {
      const key = canonicalBroker(p.name);
      const value = p.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
      const color = p.color || PROVIDER_COLORS[0];
      if (!acc[key]) {
        acc[key] = { name: key, value, color, _entries: [{ value, color }] };
      } else {
        acc[key].value += value;
        acc[key]._entries.push({ value, color });
        acc[key].color = acc[key]._entries.reduce((a, b) => a.value >= b.value ? a : b).color;
      }
      return acc;
    }, {})
  )
    .map(({ name, value, color }) => ({ name, value, color }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const accountTypeData = Object.entries(
    data.providers.reduce<Record<string, number>>((acc, p) => {
      const type = p.accountType ?? 'Other';
      const val = p.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
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
      const val = p.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
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
    <div className={`grid gap-4 items-start ${showOwner ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
      <Chart title="By Provider" data={providerData} fmt={fmt} />
      <Chart title="By Account Type" data={accountTypeData} fmt={fmt} />
      {showOwner && <Chart title="By Owner" data={ownerData} fmt={fmt} />}
    </div>
  );
}

function Chart({ title, data, fmt }: { title: string; data: { name: string; value: number; color: string }[]; fmt: (v: number) => string }) {
  const [expanded, setExpanded] = useState(true);
  const barHeight = 40;
  const chartHeight = Math.max(data.length * barHeight + 16, 80);

  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-700/20 transition-colors rounded-xl"
      >
        <p className="text-sm font-semibold text-slate-300">{title}</p>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-slate-500" />
          : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>
      {expanded && (
        <div className="px-5 pb-5">
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
                tick={{ fontSize: 12, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip fmt={fmt} />} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
