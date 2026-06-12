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
  earlyFireAge: number | null;   // retire before pension age — ISA bridges the gap
  fullFireAge: number | null;    // retire at pension access age — pension is self-sustaining
}

const DEFAULT_SWR = 0.035;

// Real monthly rate: (1 + nominal) / (1 + inflation) - 1, converted to monthly
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
  const monthlySpend = annualExpensesInRetirement / 12; // constant real spend
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
  const monthlySpend = annualExpensesInRetirement / 12; // constant real spend

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
        // Pre-pension: draw from ISA only, pension compounds untouched
        accessible = accessible * (1 + mRate) - monthlySpend;
        pension = pension * (1 + mRate);
      } else {
        // Post-pension: draw from combined proportionally so neither pot is idle
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

const ACCESSIBLE_TYPES = new Set(['ISA', 'GIA', 'Other']);
const PENSION_TYPES = new Set(['SIPP', 'Workplace Pension']);

export default function FIRECalculator({ data, onChange }: Props) {
  const s = data.fireSettings;
  const { fmt, fmtShort } = useCurrency();
  const [activeTab, setActiveTab] = useState<'split' | 'combined'>('split');

  function update(patch: Partial<FireSettings>) {
    onChange({ ...data, fireSettings: { ...s, ...patch } });
  }

  const accessibleValue = data.providers
    .filter(p => !p.accountType || ACCESSIBLE_TYPES.has(p.accountType))
    .reduce((sum, p) => sum + p.holdings.reduce((s, h) => s + h.currentValue, 0), 0);

  const pensionValue = data.providers
    .filter(p => p.accountType && PENSION_TYPES.has(p.accountType))
    .reduce((sum, p) => sum + p.holdings.reduce((s, h) => s + h.currentValue, 0), 0);

  const result = useMemo(
    () => project(s, accessibleValue, pensionValue),
    [s, accessibleValue, pensionValue],
  );

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      {/* Assumptions */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="font-semibold text-gray-900 mb-4">Assumptions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumberInput label="Current age" value={s.currentAge} min={18} max={80} onChange={v => update({ currentAge: v })} />
          <NumberInput label="Expected annual return (%/yr)" value={s.expectedAnnualReturn} min={0} max={30} step={0.5} onChange={v => update({ expectedAnnualReturn: v })} suffix="%" hint={`Nominal return (e.g. 7%). Real return ≈ ${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}%`} />
          <NumberInput label="Inflation rate (%/yr)" value={s.inflationRate} min={0} max={20} step={0.5} onChange={v => update({ inflationRate: v })} suffix="%" hint="Subtracted from nominal return. All values shown in today's money." />
          <NumberInput label="Pension access age" value={s.pensionAccessAge ?? 57} min={55} max={70} onChange={v => update({ pensionAccessAge: v })} />
          <NumberInput label="Safe withdrawal rate (%)" value={s.withdrawalRate ?? 3.5} min={2} max={6} step={0.1} onChange={v => update({ withdrawalRate: v })} suffix="%" hint={`FIRE pot needed: ${fmt(s.annualExpensesInRetirement / ((s.withdrawalRate ?? 3.5) / 100))}`} />
        </div>
      </div>

      {/* Pot summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
          <p className="text-sm font-medium text-indigo-700">Accessible pot (ISA / GIA)</p>
          <p className="text-2xl font-bold text-indigo-900 mt-1">{fmt(accessibleValue)}</p>
          <p className="text-xs text-indigo-500 mt-1">From holdings</p>
          <div className="mt-3 pt-3 border-t border-indigo-100">
            <p className="text-xs font-medium text-indigo-700 mb-2">Monthly contributions (today's £)</p>
            <NumberInput label="" value={s.monthlyContribution} min={0} step={50} onChange={v => update({ monthlyContribution: v })} prefix="£" />
          </div>
        </div>
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-5">
          <p className="text-sm font-medium text-violet-700">Pension pot (SIPP / Workplace)</p>
          <p className="text-2xl font-bold text-violet-900 mt-1">{fmt(pensionValue)}</p>
          <p className="text-xs text-violet-500 mt-1">
            From holdings · accessible at {s.pensionAccessAge ?? 57}
          </p>
          <div className="mt-3 pt-3 border-t border-violet-100">
            <p className="text-xs font-medium text-violet-700 mb-2">Monthly contribution (today's £)</p>
            <NumberInput label="" value={s.monthlyPensionContribution ?? 0} min={0} step={50} onChange={v => update({ monthlyPensionContribution: v })} prefix="£" />
          </div>
        </div>
      </div>

      {/* Spending + FIRE date */}
      {(() => {
        const fireAge = result.earlyFireAge ?? result.fullFireAge;
        const isPension = !result.earlyFireAge && !!result.fullFireAge;
        return (
          <div className="rounded-2xl p-6 border bg-emerald-50 border-emerald-100">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Spending per year (today's £)</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={s.annualExpensesInRetirement}
                    onChange={e => update({ annualExpensesInRetirement: Number(e.target.value) })}
                    className="w-32 border border-gray-200 rounded-xl pl-7 pr-3 py-2 text-lg font-bold text-indigo-600 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="h-8 w-px bg-gray-200" />
              <div>
                <p className="text-sm text-gray-600 font-medium">FIRE age</p>
                <p className="text-2xl font-bold text-gray-900">
                  {fireAge ? `Age ${fireAge.toFixed(1)}` : '—'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
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
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="font-semibold text-gray-900">Projection</h3>
            <p className="text-xs text-gray-400 mt-0.5">All values in today's money · ~{(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real return</p>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['split', 'combined'] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeTab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t === 'combined' ? 'Combined' : 'Split'}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3" />
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={result.points} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorPen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="age" tick={{ fontSize: 12 }} label={{ value: 'Age', position: 'insideBottomRight', offset: -5, fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={fmtShort} width={70} />
            <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={l => `Age ${l}`} />
            <Legend />
            <ReferenceLine x={s.pensionAccessAge ?? 57} stroke="#8b5cf6" strokeDasharray="4 3" label={{ value: `Pension unlocks`, fill: '#8b5cf6', fontSize: 11 }} />
            {(result.earlyFireAge ?? result.fullFireAge) && (
              <ReferenceLine x={Math.round((result.earlyFireAge ?? result.fullFireAge)!)} stroke="#10b981" strokeDasharray="4 3" label={{ value: 'FIRE', fill: '#10b981', fontSize: 11 }} />
            )}
            {activeTab === 'split' ? (
              <>
                <Area type="monotone" dataKey="accessible" stroke="#6366f1" strokeWidth={2} fill="url(#colorAcc)" name="Accessible (ISA/GIA)" />
                <Area type="monotone" dataKey="pension" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorPen)" name="Pension (SIPP/Workplace)" />
              </>
            ) : (
              <Area type="monotone" dataKey="combined" stroke="#10b981" strokeWidth={2} fill="url(#colorCom)" name="Combined" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Year-by-year growth table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-1 flex items-baseline justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Year-by-year</h3>
          <p className="text-xs text-gray-400">All values in today's money</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Age</th>
                <th className="text-left px-4 py-3 font-medium">Year</th>
                <th className="text-right px-4 py-3 font-medium text-indigo-600">
                  <TextTooltip text={`Compounds at ~${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real/yr + £${s.monthlyContribution.toLocaleString()}/mo contributions`} className="border-b border-dashed border-indigo-300">ISA / GIA</TextTooltip>
                </th>
                <th className="text-right px-4 py-3 font-medium text-violet-600">
                  <TextTooltip text={`Compounds at ~${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real/yr + £${(s.monthlyPensionContribution ?? 0).toLocaleString()}/mo contributions`} className="border-b border-dashed border-violet-300">Pension</TextTooltip>
                </th>
                <th className="text-right px-4 py-3 font-medium">Combined</th>
                <th className="text-right px-4 py-3 font-medium text-emerald-600">Withdrawn/yr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {result.points.map((pt, i) => {
                const prev = result.points[i - 1];
                const year = currentYear + (pt.age - s.currentAge);
                const retireAge = Math.min(result.earlyFireAge ?? Infinity, result.fullFireAge ?? Infinity);
                const isFired = isFinite(retireAge) && pt.age >= retireAge;
                const pensionAccessAge = s.pensionAccessAge ?? 57;
                const prevPensionUnlocked = prev ? prev.age >= pensionAccessAge : false;
                const fireAge = result.earlyFireAge ?? result.fullFireAge;
                const isFireAge = fireAge !== null && pt.age === Math.round(fireAge);
                const isPensionAccess = pt.age === pensionAccessAge;
                const rateLabel = `~${(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real (${s.expectedAnnualReturn}% − ${s.inflationRate}% inflation)`;

                // isDrawing: was the previous year already in retirement (i.e. did drawdown happen this year)?
                const isDrawing = isFinite(retireAge) && (prev ? prev.age >= retireAge : false);
                const accContributed = !isDrawing ? s.monthlyContribution * 12 : 0;
                const penContributed = !isDrawing ? (s.monthlyPensionContribution ?? 0) * 12 : 0;
                const accWithdrawn = isDrawing && !prevPensionUnlocked ? s.annualExpensesInRetirement : 0;
                const penWithdrawn = isDrawing && prevPensionUnlocked ? s.annualExpensesInRetirement : 0;

                const prevAcc = prev?.accessible ?? 0;
                const prevPen = prev?.pension ?? 0;
                const prevCom = prev?.combined ?? 0;
                // Residual interest = change minus cash flows, guaranteed to balance
                const accInterest = prev ? pt.accessible - prevAcc + accWithdrawn - accContributed : 0;
                const penInterest = prev ? pt.pension - prevPen + penWithdrawn - penContributed : 0;

                const accGrowth = prev ? pt.accessible - prevAcc : null;
                const penGrowth = prev ? pt.pension - prevPen : null;
                const comGrowth = prev ? pt.combined - prevCom : null;

                return (
                  <tr
                    key={pt.age}
                    className={`transition-colors ${isFireAge ? 'bg-emerald-50' : isPensionAccess ? 'bg-violet-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {pt.age}
                      {isFireAge && <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">FIRE</span>}
                      {isPensionAccess && !isFireAge && <span className="ml-2 text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">Pension unlocks</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{year}</td>
                    <td className="px-4 py-2.5 text-right text-indigo-700">
                      {fmtShort(pt.accessible)}
                      {accGrowth !== null && prev && <Delta v={accGrowth} breakdown={{ from: prevAcc, interest: accInterest, contributed: accContributed, withdrawn: accWithdrawn, to: pt.accessible, rateLabel, isFire: isFireAge }} />}
                    </td>
                    <td className="px-4 py-2.5 text-right text-violet-700">
                      {fmtShort(pt.pension)}
                      {penGrowth !== null && prev && <Delta v={penGrowth} breakdown={{ from: prevPen, interest: penInterest, contributed: penContributed, withdrawn: penWithdrawn, to: pt.pension, rateLabel, isFire: isFireAge }} />}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                      {fmtShort(pt.combined)}
                      {comGrowth !== null && prev && <Delta v={comGrowth} breakdown={{ from: prevCom, interest: accInterest + penInterest, contributed: accContributed + penContributed, withdrawn: accWithdrawn + penWithdrawn, to: pt.combined, rateLabel, isFire: isFireAge }} />}
                    </td>
                    <td className="px-4 py-2.5 text-right text-emerald-700 font-medium">
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
          <div className="bg-gray-900 text-gray-100 rounded-xl shadow-xl px-3 py-2 text-xs border border-gray-700 max-w-[260px]">
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
    { label: `Growth (${breakdown.rateLabel})`, value: `+${fmt(interest)}`, color: 'text-emerald-400' },
    ...(contributed ? [{ label: breakdown.isFire ? 'Final year savings' : 'Contributions', value: `+${fmt(contributed)}`, color: 'text-blue-400' }] : []),
    ...(withdrawn ? [{ label: 'Withdrawn', value: `-${fmt(withdrawn)}`, color: 'text-red-400' }] : []),
    { label: 'New total', value: fmt(to), color: 'text-white font-semibold' },
  ];

  return (
    <>
      <span
        ref={ref}
        className={`ml-1 text-xs cursor-help ${positive ? 'text-emerald-600' : 'text-red-400'}`}
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
          <div className="bg-gray-900 text-gray-100 rounded-xl shadow-xl p-3 min-w-[220px] text-xs border border-gray-700">
            <table className="w-full border-separate" style={{ borderSpacing: '0 2px' }}>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="text-gray-400 pr-4 whitespace-nowrap">{row.label}</td>
                    <td className={`text-right font-mono whitespace-nowrap ${row.color ?? 'text-gray-100'}`}>{row.value}</td>
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
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{prefix}</span>}
        <input
          type="number"
          className={`w-full border border-gray-200 rounded-xl py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white ${prefix ? 'pl-7 pr-4' : suffix ? 'pl-4 pr-7' : 'px-4'}`}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(Number(e.target.value))}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
