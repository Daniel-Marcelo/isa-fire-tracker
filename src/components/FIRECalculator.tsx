import React, { useState, useMemo, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import type { AppData, FireSettings } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';

interface Props {
  data: AppData;
  onChange: (data: AppData) => void;
}

interface ProjectionResult {
  points: { age: number; accessible: number; pension: number; combined: number }[];
  earlyFireAge: number | null;
  fullFireAge: number | null;
}

const DEFAULT_SWR = 0.035;

function realMonthlyRate(nominalPct: number, inflationPct: number): number {
  const realAnnual = (1 + nominalPct / 100) / (1 + inflationPct / 100) - 1;
  return Math.pow(1 + realAnnual, 1 / 12) - 1;
}

function findFireAges(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
): { earlyFireAge: number | null; fullFireAge: number | null } {
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate, annualExpensesInRetirement } = settings;
  const mRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const totalMonthlyPension = monthlyPensionContribution ?? 0;
  const monthlySpend = annualExpensesInRetirement / 12;
  const swr = (settings.withdrawalRate ?? DEFAULT_SWR * 100) / 100;
  const pensionTarget = annualExpensesInRetirement / swr;

  let accessible = accessibleStart;
  let pension = pensionStart;
  let earlyFireAge: number | null = null;
  let fullFireAge: number | null = null;

  for (let m = 0; m <= 600; m++) {
    const age = currentAge + m / 12;

    if (m % 12 === 0) {
      if (earlyFireAge === null && age < pensionAccessAge) {
        const monthsUntilPension = Math.round((pensionAccessAge - age) * 12);
        let sim = accessible;
        let bridgeOk = true;
        for (let i = 0; i < monthsUntilPension; i++) {
          sim = sim * (1 + mRate) - monthlySpend;
          if (sim < 0) { bridgeOk = false; break; }
        }
        if (bridgeOk) {
          let simPension = pension;
          for (let i = 0; i < monthsUntilPension; i++) {
            simPension = simPension * (1 + mRate);
          }
          if (sim + simPension >= pensionTarget) earlyFireAge = age;
        }
      }

      if (fullFireAge === null && age >= pensionAccessAge) {
        if (Math.max(accessible, 0) + pension >= pensionTarget) fullFireAge = age;
      }

      if (earlyFireAge !== null && fullFireAge !== null) break;
    }

    const retiredYet = earlyFireAge !== null && age >= earlyFireAge;
    accessible = accessible * (1 + mRate) + (retiredYet ? 0 : monthlyContribution);
    pension = pension * (1 + mRate) + (retiredYet ? 0 : totalMonthlyPension);
  }

  return { earlyFireAge, fullFireAge };
}

function project(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
): ProjectionResult {
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate, annualExpensesInRetirement } = settings;

  const mRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const totalMonthlyPension = monthlyPensionContribution ?? 0;
  const monthlySpend = annualExpensesInRetirement / 12;

  const { earlyFireAge, fullFireAge } = findFireAges(settings, accessibleStart, pensionStart);
  const retireAge = Math.min(earlyFireAge ?? Infinity, fullFireAge ?? Infinity);

  const points: ProjectionResult['points'] = [];
  let accessible = accessibleStart;
  let pension = pensionStart;

  for (let m = 0; m <= 600; m++) {
    const age = currentAge + m / 12;
    const retired = isFinite(retireAge) && age >= retireAge;
    const pensionUnlockedForDrawdown = age >= pensionAccessAge;

    if (m % 12 === 0) {
      points.push({
        age: Math.round(age),
        accessible: Math.round(Math.max(accessible, 0)),
        pension: Math.round(Math.max(pension, 0)),
        combined: Math.round(Math.max(accessible, 0) + Math.max(pension, 0)),
      });
    }

    if (retired) {
      if (!pensionUnlockedForDrawdown) {
        accessible = accessible * (1 + mRate) - monthlySpend;
        pension = pension * (1 + mRate);
      } else {
        const total = Math.max(accessible + pension, 0);
        const accRatio = total > 0 ? Math.max(accessible, 0) / total : 0;
        accessible = accessible * (1 + mRate) - monthlySpend * accRatio;
        pension = pension * (1 + mRate) - monthlySpend * (1 - accRatio);
      }
    } else {
      accessible = accessible * (1 + mRate) + monthlyContribution;
      pension = pension * (1 + mRate) + totalMonthlyPension;
    }
  }

  return { points, earlyFireAge, fullFireAge };
}

const ACCESSIBLE_TYPES = new Set(['ISA', 'GIA']);
const PENSION_TYPES = new Set(['SIPP', 'Workplace Pension']);

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '10px',
    color: '#f8fafc',
    fontSize: 12,
    padding: '8px 12px',
  },
  labelStyle: { color: '#94a3b8', marginBottom: 4 },
  itemStyle: { color: '#cbd5e1' },
};

export default function FIRECalculator({ data, onChange }: Props) {
  const s = data.fireSettings;
  const { fmt, fmtShort } = useCurrency();
  const [activeTab, setActiveTab] = useState<'split' | 'combined'>('split');

  function update(patch: Partial<FireSettings>) {
    onChange({ ...data, fireSettings: { ...s, ...patch } });
  }

  const accessibleValue = data.providers
    .filter(p => !p.accountType || ACCESSIBLE_TYPES.has(p.accountType))
    .reduce((sum, p) => sum + p.holdings.reduce((s, h) => s + h.currentValue ?? 0, 0), 0);

  const pensionValue = data.providers
    .filter(p => p.accountType && PENSION_TYPES.has(p.accountType))
    .reduce((sum, p) => sum + p.holdings.reduce((s, h) => s + h.currentValue ?? 0, 0), 0);

  const result = useMemo(
    () => project(s, accessibleValue, pensionValue),
    [s, accessibleValue, pensionValue],
  );

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-4">
      {/* Assumptions */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
        <h3 className="font-semibold text-slate-100 mb-4">Assumptions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumberInput label="Current age" value={s.currentAge} min={18} max={80} onChange={v => update({ currentAge: v })} />
          <NumberInput label="Expected annual return (%/yr)" value={s.expectedAnnualReturn} min={0} max={30} step={0.5} onChange={v => update({ expectedAnnualReturn: v })} suffix="%" hint={`Nominal return (e.g. 7%). Real return ≈ ${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}%`} />
          <NumberInput label="Inflation rate (%/yr)" value={s.inflationRate} min={0} max={20} step={0.5} onChange={v => update({ inflationRate: v })} suffix="%" hint="Subtracted from nominal return. All values in today's money." />
          <NumberInput label="Pension access age" value={s.pensionAccessAge ?? 57} min={55} max={70} onChange={v => update({ pensionAccessAge: v })} />
          <NumberInput label="Safe withdrawal rate (%)" value={s.withdrawalRate ?? 3.5} min={2} max={6} step={0.1} onChange={v => update({ withdrawalRate: v })} suffix="%" hint={`FIRE pot needed: ${fmt(s.annualExpensesInRetirement / ((s.withdrawalRate ?? 3.5) / 100))}`} />
        </div>
      </div>

      {/* Pot summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-1">ISA / GIA</p>
          <p className="text-2xl font-bold text-slate-50 tabular-nums">{fmt(accessibleValue)}</p>
          <p className="text-xs text-slate-600 mt-1">From holdings</p>
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <p className="text-xs font-medium text-slate-500 mb-2">Monthly contributions</p>
            <NumberInput label="" value={s.monthlyContribution} min={0} step={50} onChange={v => update({ monthlyContribution: v })} prefix="£" />
          </div>
        </div>
        <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
          <p className="text-xs font-medium text-violet-400 uppercase tracking-wide mb-1">Pension / SIPP</p>
          <p className="text-2xl font-bold text-slate-50 tabular-nums">{fmt(pensionValue)}</p>
          <p className="text-xs text-slate-600 mt-1">Accessible at {s.pensionAccessAge ?? 57}</p>
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <p className="text-xs font-medium text-slate-500 mb-2">Monthly contributions</p>
            <NumberInput label="" value={s.monthlyPensionContribution ?? 0} min={0} step={50} onChange={v => update({ monthlyPensionContribution: v })} prefix="£" />
          </div>
        </div>
      </div>

      {/* Spending + FIRE date */}
      {(() => {
        const fireAge = result.earlyFireAge ?? result.fullFireAge;
        const isPension = !result.earlyFireAge && !!result.fullFireAge;
        return (
          <div className="rounded-xl p-5 border bg-slate-800/70 border-green-800/30">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-400 whitespace-nowrap">Spending / year</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">£</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={s.annualExpensesInRetirement}
                    onChange={e => update({ annualExpensesInRetirement: Number(e.target.value) })}
                    className="w-32 border border-slate-600 rounded-xl pl-7 pr-3 py-2 text-lg font-bold text-green-400 bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                  />
                </div>
              </div>
              <div className="h-8 w-px bg-slate-700" />
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">FIRE age</p>
                <p className="text-2xl font-bold text-slate-50 tabular-nums">
                  {fireAge ? `Age ${fireAge.toFixed(1)}` : '—'}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {fireAge
                    ? isPension ? 'At pension access age' : 'ISA bridges to pension'
                    : 'Increase contributions or reduce spending'}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Chart */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-100">Projection</h3>
            <p className="text-xs text-slate-600 mt-0.5">All values in today's money · ~{(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real return</p>
          </div>
          <div className="flex gap-0.5 bg-slate-900 rounded-lg p-1">
            {(['split', 'combined'] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeTab === t ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {t === 'combined' ? 'Combined' : 'Split'}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={result.points} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorPen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="age" tick={{ fontSize: 11, fill: '#64748b' }} label={{ value: 'Age', position: 'insideBottomRight', offset: -5, fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={fmtShort} width={70} />
            <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmt(Number(v))} labelFormatter={l => `Age ${l}`} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <ReferenceLine x={s.pensionAccessAge ?? 57} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: `Pension`, fill: '#a78bfa', fontSize: 10 }} />
            {(result.earlyFireAge ?? result.fullFireAge) && (
              <ReferenceLine x={Math.round((result.earlyFireAge ?? result.fullFireAge)!)} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: 'FIRE', fill: '#4ade80', fontSize: 10 }} />
            )}
            {activeTab === 'split' ? (
              <>
                <Area type="monotone" dataKey="accessible" stroke="#6366f1" strokeWidth={2} fill="url(#colorAcc)" name="Accessible (ISA/GIA)" />
                <Area type="monotone" dataKey="pension" stroke="#a78bfa" strokeWidth={2} fill="url(#colorPen)" name="Pension (SIPP/Workplace)" />
              </>
            ) : (
              <Area type="monotone" dataKey="combined" stroke="#4ade80" strokeWidth={2} fill="url(#colorCom)" name="Combined" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Year-by-year table */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="px-5 py-3 flex items-baseline justify-between border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-100 text-sm">Year-by-year</h3>
          <p className="text-xs text-slate-600">All values in today's money</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60">
              <tr className="text-xs text-slate-600 uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Age</th>
                <th className="text-left px-4 py-3 font-medium">Year</th>
                <th className="text-right px-4 py-3 font-medium text-indigo-400">
                  <TextTooltip text={`Compounds at ~${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real/yr + £${s.monthlyContribution.toLocaleString()}/mo contributions`} className="border-b border-dashed border-indigo-700">ISA / GIA</TextTooltip>
                </th>
                <th className="text-right px-4 py-3 font-medium text-violet-400">
                  <TextTooltip text={`Compounds at ~${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real/yr + £${(s.monthlyPensionContribution ?? 0).toLocaleString()}/mo contributions`} className="border-b border-dashed border-violet-700">Pension</TextTooltip>
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-400">Combined</th>
                <th className="text-right px-4 py-3 font-medium text-green-400">Withdrawn/yr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {result.points.map((pt, i) => {
                const prev = result.points[i - 1];
                const year = currentYear + (pt.age - s.currentAge);
                const retireAge = Math.min(result.earlyFireAge ?? Infinity, result.fullFireAge ?? Infinity);

                const pensionAccessAge = s.pensionAccessAge ?? 57;
                const prevPensionUnlocked = prev ? prev.age >= pensionAccessAge : false;
                const fireAge = result.earlyFireAge ?? result.fullFireAge;
                const isFireAge = fireAge !== null && pt.age === Math.round(fireAge);
                const isPensionAccess = pt.age === pensionAccessAge;
                const rateLabel = `~${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real (${s.expectedAnnualReturn}% − ${s.inflationRate}% inflation)`;

                const isDrawing = isFinite(retireAge) && (prev ? prev.age >= retireAge : false);
                const accContributed = !isDrawing ? s.monthlyContribution * 12 : 0;
                const penContributed = !isDrawing ? (s.monthlyPensionContribution ?? 0) * 12 : 0;
                const accWithdrawn = isDrawing && !prevPensionUnlocked ? s.annualExpensesInRetirement : 0;
                const penWithdrawn = isDrawing && prevPensionUnlocked ? s.annualExpensesInRetirement : 0;

                const prevAcc = prev?.accessible ?? 0;
                const prevPen = prev?.pension ?? 0;
                const prevCom = prev?.combined ?? 0;
                const accInterest = prev ? pt.accessible - prevAcc + accWithdrawn - accContributed : 0;
                const penInterest = prev ? pt.pension - prevPen + penWithdrawn - penContributed : 0;

                const accGrowth = prev ? pt.accessible - prevAcc : null;
                const penGrowth = prev ? pt.pension - prevPen : null;
                const comGrowth = prev ? pt.combined - prevCom : null;

                return (
                  <tr
                    key={pt.age}
                    className={`transition-colors ${isFireAge ? 'bg-green-900/15' : isPensionAccess ? 'bg-violet-900/15' : 'hover:bg-slate-700/20'}`}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-200 tabular-nums">
                      {pt.age}
                      {isFireAge && <span className="ml-2 text-xs bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded-full">FIRE</span>}
                      {isPensionAccess && !isFireAge && <span className="ml-2 text-xs bg-violet-900/40 text-violet-400 px-1.5 py-0.5 rounded-full">Pension</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 tabular-nums">{year}</td>
                    <td className="px-4 py-2.5 text-right text-indigo-400 tabular-nums">
                      {fmtShort(pt.accessible)}
                      {accGrowth !== null && prev && <Delta v={accGrowth} breakdown={{ from: prevAcc, interest: accInterest, contributed: accContributed, withdrawn: accWithdrawn, to: pt.accessible, rateLabel, isFire: isFireAge }} />}
                    </td>
                    <td className="px-4 py-2.5 text-right text-violet-400 tabular-nums">
                      {fmtShort(pt.pension)}
                      {penGrowth !== null && prev && <Delta v={penGrowth} breakdown={{ from: prevPen, interest: penInterest, contributed: penContributed, withdrawn: penWithdrawn, to: pt.pension, rateLabel, isFire: isFireAge }} />}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-200 tabular-nums">
                      {fmtShort(pt.combined)}
                      {comGrowth !== null && prev && <Delta v={comGrowth} breakdown={{ from: prevCom, interest: accInterest + penInterest, contributed: accContributed + penContributed, withdrawn: accWithdrawn + penWithdrawn, to: pt.combined, rateLabel, isFire: isFireAge }} />}
                    </td>
                    <td className="px-4 py-2.5 text-right text-green-400 font-medium tabular-nums">
                      {isDrawing ? fmtShort(s.annualExpensesInRetirement) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface DeltaBreakdown {
  from: number;
  interest: number;
  contributed: number;
  withdrawn: number;
  to: number;
  rateLabel: string;
  isFire?: boolean;
}

function TextTooltip({ children, text, className }: { children: React.ReactNode; text: string; className?: string }) {
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <span
        className={`cursor-help ${className ?? ''}`}
        onMouseEnter={e => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTipPos(null)}
      >
        {children}
      </span>
      {tipPos && (
        <div className="fixed z-[9999] pointer-events-none" style={{ left: tipPos.x + 12, top: tipPos.y - 8 }}>
          <div className="bg-slate-800 text-slate-300 rounded-xl shadow-2xl px-3 py-2 text-xs border border-slate-700 max-w-[260px]">
            {text}
          </div>
        </div>
      )}
    </>
  );
}

function Delta({ v, breakdown }: { v: number; breakdown: DeltaBreakdown }) {
  const positive = v >= 0;
  const fmt = (n: number) => n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
  const fmtShort = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
    if (abs >= 1_000) return `£${(n / 1_000).toFixed(1)}k`;
    return `£${n.toFixed(0)}`;
  };
  const { from, interest, contributed, withdrawn, to } = breakdown;
  const ref = useRef<HTMLSpanElement>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const rows: { label: string; value: string; color?: string }[] = [
    { label: 'Previous', value: fmt(from) },
    { label: `Growth (${breakdown.rateLabel})`, value: `+${fmt(interest)}`, color: 'text-green-400' },
    ...(contributed ? [{ label: breakdown.isFire ? 'Final year savings' : 'Contributions', value: `+${fmt(contributed)}`, color: 'text-indigo-400' }] : []),
    ...(withdrawn ? [{ label: 'Withdrawn', value: `-${fmt(withdrawn)}`, color: 'text-red-400' }] : []),
    { label: 'New total', value: fmt(to), color: 'text-slate-100 font-semibold' },
  ];

  return (
    <>
      <span
        ref={ref}
        className={`ml-1 text-xs cursor-help tabular-nums ${positive ? 'text-green-400/70' : 'text-red-400/70'}`}
        onMouseEnter={e => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTipPos(null)}
      >
        ({positive ? '+' : ''}{fmtShort(v)})
      </span>
      {tipPos && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: tipPos.x + 12, top: tipPos.y - 8 }}
        >
          <div className="bg-slate-800 text-slate-300 rounded-xl shadow-2xl p-3 min-w-[220px] text-xs border border-slate-700">
            <table className="w-full border-separate" style={{ borderSpacing: '0 2px' }}>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="text-slate-500 pr-4 whitespace-nowrap">{row.label}</td>
                    <td className={`text-right font-mono whitespace-nowrap tabular-nums ${row.color ?? 'text-slate-300'}`}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function NumberInput({ label, value, min, max, step = 1, prefix, suffix, hint, onChange }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-slate-400 mb-1.5">{label}</label>}
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{prefix}</span>}
        <input
          type="number"
          className={`w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums text-sm transition-colors ${prefix ? 'pl-7 pr-4' : suffix ? 'pl-4 pr-7' : 'px-4'}`}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(Number(e.target.value))}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
    </div>
  );
}
