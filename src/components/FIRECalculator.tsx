import React, { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import {
  AreaChart, Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import type { AppData, FireSettings } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { project } from '../lib/fireProjection';
import { planToAgeOf, targetConfidenceOf } from '../lib/fireEngine';
import type { FireCalcRequest, FireCalcResult } from '../lib/fireWorker';
import { isPensionType } from '../utils';

interface Props {
  data: AppData;
  rawData: AppData;
  onChange: (data: AppData) => void;
}

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

function confidenceColor(rate: number | null): string {
  if (rate == null) return 'text-slate-600';
  if (rate >= 0.9) return 'text-green-400';
  if (rate >= 0.75) return 'text-amber-400';
  return 'text-red-400';
}

/** Inline "working" indicator shown while the Monte Carlo worker recomputes. */
function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-indigo-400 normal-case tracking-normal">
      <span className="inline-block w-3 h-3 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin" />
      {label}
    </span>
  );
}

export default function FIRECalculator({ data, rawData, onChange }: Props) {
  const s = data.fireSettings;
  const { fmt, fmtShort } = useCurrency();
  const [activeTab, setActiveTab] = useState<'split' | 'combined'>('split');

  // Write through rawData, never data: data's holdings carry display-converted
  // costBasis and derived values that must not become the canonical state.
  function update(patch: Partial<FireSettings>) {
    onChange({ ...rawData, fireSettings: { ...rawData.fireSettings, ...patch } });
  }

  const accessibleValue = data.providers
    .filter(p => !isPensionType(p.accountType))
    .reduce((sum, p) => sum + p.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0), 0);

  const pensionValue = data.providers
    .filter(p => isPensionType(p.accountType))
    .reduce((sum, p) => sum + p.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0), 0);

  const mode = s.fireMode ?? 'earliest';
  const planTo = planToAgeOf(s);
  const confTarget = targetConfidenceOf(s);
  const degenerateHorizon = planTo <= s.currentAge + 1;
  const statePensionOn = s.statePensionEnabled ?? true;
  const statePensionAge = s.statePensionAge ?? 67;
  const pensionAccessAge = s.pensionAccessAge ?? 57;

  // The projection itself is a single cheap pass, but the chart and 66-row table
  // it feeds are expensive to reconcile. Run it off a deferred settings snapshot
  // so a keystroke doesn't rebuild them; they settle a beat after typing stops.
  // (The heavy Monte Carlo suite runs in the worker below, off the main thread.)
  const ds = useDeferredValue(s);
  const result = useMemo(
    () => project(ds, accessibleValue, pensionValue),
    [ds, accessibleValue, pensionValue],
  );
  const smoothAge = result.earlyFireAge ?? result.fullFireAge;

  // A single Monte Carlo recompute is ~40 simulations (~4s), which would freeze
  // the tab on every keystroke. Offload it to a worker: keep showing the last
  // result (dimmed) while a new one computes in the background, then swap it in.
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const [calc, setCalc] = useState<FireCalcResult | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(true);

  // Terminate the worker on unmount so it doesn't outlive the component.
  useEffect(() => () => workerRef.current?.terminate(), []);

  // Debounce, then dispatch. Two reasons the debounce stays even though the work
  // is off-thread: the worker is single-threaded (posting per keystroke queues a
  // backlog, so the latest answer would arrive *after* every stale one), and each
  // dispatch spins up a fresh worker — we don't want one per character. On each
  // dispatch we terminate() any in-flight job: it can't be interrupted by a new
  // message, so killing it lets the newest edit compute now instead of waiting.
  useEffect(() => {
    setIsRecomputing(true);
    const t = setTimeout(() => {
      workerRef.current?.terminate();
      const w = new Worker(new URL('../lib/fireWorker.ts', import.meta.url), { type: 'module' });
      const id = ++reqIdRef.current;
      w.onmessage = (e: MessageEvent<FireCalcResult>) => {
        if (e.data.id !== id) return; // ignore a straggler from a killed worker
        setCalc(e.data);
        setIsRecomputing(false);
      };
      workerRef.current = w;
      const req: FireCalcRequest = { id, settings: s, accessible: accessibleValue, pension: pensionValue };
      w.postMessage(req);
    }, 300);
    return () => clearTimeout(t);
  }, [s, accessibleValue, pensionValue]);

  const solvedAge = calc?.solvedAge ?? null;
  const chosenAge = Math.min(Math.max(s.targetRetirementAge ?? 55, s.currentAge), planTo);
  const headlineAge = calc?.headlineAge ?? null;
  const mc = calc?.mc ?? null;
  const confidence = mc && mc.runs > 0 ? mc.successRate : null;
  const curve = calc?.curve ?? [];
  const sensitivity = calc?.sensitivity ?? null;
  // True only until the worker's very first result lands (thereafter the last
  // result is kept on screen, dimmed, while a new one computes).
  const awaitingFirst = calc == null;

  // The recharts SVG trees are expensive to reconcile. Memoise each so a keystroke
  // only rebuilds a chart when its underlying data (worker result / projection)
  // actually changes, not on every render.
  const curveChart = useMemo(() => (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={curve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="age" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11, fill: '#64748b' }} tickCount={10} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `${v}%`} width={45} />
        <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Confidence']} labelFormatter={l => `Retire at ${l}`} />
        <ReferenceLine y={confTarget} stroke="#facc15" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: `${confTarget}% target`, fill: '#facc15', fontSize: 10, position: 'insideBottomLeft' }} />
        {headlineAge != null && (
          <ReferenceLine x={headlineAge} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} />
        )}
        <Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2} dot={false} name="Confidence" />
      </ComposedChart>
    </ResponsiveContainer>
  ), [curve, confTarget, headlineAge]);

  const marketChart = useMemo(() => (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={mc?.bands ?? []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="age" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={fmtShort} width={70} />
        <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmt(Number(v))} labelFormatter={l => `Age ${l}`} />
        <ReferenceLine x={pensionAccessAge} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} />
        {statePensionOn && (
          <ReferenceLine x={statePensionAge} stroke="#2dd4bf" strokeDasharray="4 3" strokeOpacity={0.6} />
        )}
        {headlineAge != null && (
          <ReferenceLine x={Math.round(headlineAge)} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} />
        )}
        <Line type="monotone" dataKey="p90" stroke="#34d399" strokeWidth={1} dot={false} strokeOpacity={0.6} name="90th percentile" />
        <Line type="monotone" dataKey="p50" stroke="#6366f1" strokeWidth={2} dot={false} name="Median" />
        <Line type="monotone" dataKey="p10" stroke="#f87171" strokeWidth={1} dot={false} strokeOpacity={0.7} name="10th percentile" />
        <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
      </ComposedChart>
    </ResponsiveContainer>
  ), [mc, statePensionOn, statePensionAge, headlineAge, pensionAccessAge, fmt, fmtShort]);

  const projectionChart = useMemo(() => (
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
        <ReferenceLine x={pensionAccessAge} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: `Pension`, fill: '#a78bfa', fontSize: 10 }} />
        {statePensionOn && (
          <ReferenceLine x={statePensionAge} stroke="#2dd4bf" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: 'State pension', fill: '#2dd4bf', fontSize: 10 }} />
        )}
        {smoothAge != null && (
          <ReferenceLine x={Math.round(smoothAge)} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: 'FIRE', fill: '#4ade80', fontSize: 10 }} />
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
  ), [result, activeTab, statePensionOn, statePensionAge, smoothAge, pensionAccessAge, fmt, fmtShort]);

  const currentYear = new Date().getFullYear();

  // The 66-row table (each cell carrying a hover-tooltip component) is the last
  // heavy subtree; memoise it so a keystroke only reconciles it when a value changes.
  const yearTable = useMemo(() => {
    const realRate = (ds.expectedAnnualReturn - ds.inflationRate).toFixed(1);
    const monthlyContribution = ds.monthlyContribution;
    const monthlyPension = ds.monthlyPensionContribution ?? 0;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60">
            <tr className="text-xs text-slate-600 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Age</th>
              <th className="text-left px-4 py-3 font-medium">Year</th>
              <th className="text-right px-4 py-3 font-medium text-indigo-400">
                <TextTooltip text={`Compounds at ~${realRate}% real/yr + £${monthlyContribution.toLocaleString()}/mo contributions`} className="border-b border-dashed border-indigo-700">ISA / GIA</TextTooltip>
              </th>
              <th className="text-right px-4 py-3 font-medium text-violet-400">
                <TextTooltip text={`Compounds at ~${realRate}% real/yr + £${monthlyPension.toLocaleString()}/mo contributions`} className="border-b border-dashed border-violet-700">Pension</TextTooltip>
              </th>
              <th className="text-right px-4 py-3 font-medium text-slate-400">Combined</th>
              <th className="text-right px-4 py-3 font-medium text-green-400">
                <TextTooltip text="Actual pot outflow that year: spending minus state pension, with pension withdrawals grossed up for tax" className="border-b border-dashed border-green-700">Withdrawn/yr</TextTooltip>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {result.points.map((pt, i) => {
              const prev = result.points[i - 1];
              const year = currentYear + (pt.age - ds.currentAge);
              const retireAge = Math.min(result.earlyFireAge ?? Infinity, result.fullFireAge ?? Infinity);

              const fireAge = result.earlyFireAge ?? result.fullFireAge;
              const isFireAge = fireAge !== null && pt.age === Math.round(fireAge);
              const isPensionAccess = pt.age === pensionAccessAge;
              const isStatePension = statePensionOn && pt.age === statePensionAge;
              const rateLabel = `~${realRate}% real (${ds.expectedAnnualReturn}% − ${ds.inflationRate}% inflation)`;

              const isDrawing = isFinite(retireAge) && (prev ? prev.age >= retireAge : false);
              const accContributed = !isDrawing ? monthlyContribution * 12 : 0;
              const penContributed = !isDrawing ? monthlyPension * 12 : 0;
              const accWithdrawn = pt.accWithdrawn;
              const penWithdrawn = pt.penWithdrawn;
              const totalWithdrawn = accWithdrawn + penWithdrawn;

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
                    {isStatePension && !isFireAge && !isPensionAccess && <span className="ml-2 text-xs bg-teal-900/40 text-teal-400 px-1.5 py-0.5 rounded-full">State pension</span>}
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
                    {comGrowth !== null && prev && <Delta v={comGrowth} breakdown={{ from: prevCom, interest: accInterest + penInterest, contributed: accContributed + penContributed, withdrawn: totalWithdrawn, to: pt.combined, rateLabel, isFire: isFireAge }} />}
                  </td>
                  <td className="px-4 py-2.5 text-right text-green-400 font-medium tabular-nums">
                    {totalWithdrawn > 0 ? fmtShort(totalWithdrawn) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [result, currentYear, ds, statePensionOn, statePensionAge, pensionAccessAge, fmtShort]);

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
          <NumberInput label="Target confidence (%)" value={s.targetConfidence ?? 90} min={50} max={99} onChange={v => update({ targetConfidence: v })} suffix="%" hint="Monte Carlo success rate the earliest-age solver must reach" />
          <NumberInput label="Plan to age" value={s.planToAge ?? 95} min={80} max={105} onChange={v => update({ planToAge: v })} hint="Money must last to this age · horizon capped at 75 years" />
          <NumberInput label="Return volatility (%/yr)" value={s.returnVolatility ?? 15} min={0} max={50} step={1} onChange={v => update({ returnVolatility: v })} suffix="%" hint="Annual std dev. All-equity ≈ 15–18, 60/40 ≈ 10, cash ≈ 1" />
          <NumberInput label="Pension drawdown tax (%)" value={s.pensionTaxRate ?? 15} min={0} max={60} step={1} onChange={v => update({ pensionTaxRate: v })} suffix="%" hint="Effective rate on pension withdrawals; ISA withdrawals are tax-free." />
          <NumberInput label="Safe withdrawal rate (%)" value={s.withdrawalRate ?? 3.5} min={2} max={6} step={0.1} onChange={v => update({ withdrawalRate: v })} suffix="%" hint="Used for the Portfolio tab's SWR card — FIRE age is confidence-based now." />
        </div>
        <div className="mt-5 pt-4 border-t border-slate-700/50">
          <div className="flex items-center gap-3 mb-3">
            <button
              role="switch"
              aria-checked={statePensionOn}
              onClick={() => update({ statePensionEnabled: !statePensionOn })}
              className={`relative w-9 h-5 rounded-full transition-colors ${statePensionOn ? 'bg-teal-600' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-slate-100 transition-all ${statePensionOn ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <span className="text-sm font-medium text-slate-300">State pension</span>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${statePensionOn ? '' : 'opacity-40 pointer-events-none'}`}>
            <NumberInput label="Amount (£/yr, today's money)" value={s.statePensionAnnual ?? 12000} min={0} step={100} onChange={v => update({ statePensionAnnual: v })} prefix="£" hint="Paid worldwide based on your NI record — check gov.uk for your forecast. Enter your accrued amount to be conservative, or £0 to ignore it." />
            <NumberInput label="From age" value={s.statePensionAge ?? 67} min={60} max={75} onChange={v => update({ statePensionAge: v })} hint="From this age the pots only fund spending above the state pension" />
          </div>
        </div>
      </div>

      {/* Pot summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-1">ISA / GIA / Cash</p>
          <p className="text-2xl font-bold text-slate-50 tabular-nums">{fmt(accessibleValue)}</p>
          <p className="text-xs text-slate-600 mt-1">From holdings · growth assumption applies to the whole pot, incl. cash</p>
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

      {/* Spending + hero */}
      <div className="rounded-xl p-5 border bg-slate-800/70 border-green-800/30">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
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
          <div className="flex gap-0.5 bg-slate-900 rounded-lg p-1">
            {([['earliest', 'Earliest age'], ['fixedAge', 'Chosen age']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => update({ fireMode: m })}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${mode === m ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={`flex flex-wrap items-center gap-6 transition-opacity ${isRecomputing ? 'opacity-50' : ''}`}>
          {mode === 'earliest' ? (
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">FIRE age {isRecomputing && <Spinner label="Calculating…" />}</p>
              <p className="text-3xl font-bold text-slate-50 tabular-nums">
                {solvedAge != null ? `Age ${solvedAge.toFixed(1)}` : awaitingFirst ? '…' : '—'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {solvedAge != null
                  ? `Earliest retirement with ≥${confTarget}% confidence${smoothAge != null ? ` · smooth-market estimate: ${smoothAge.toFixed(1)}` : ''}`
                  : awaitingFirst
                    ? 'Estimating your earliest retirement age…'
                    : degenerateHorizon
                      ? 'Plan-to age must be beyond your current age'
                      : `Not reachable by ${planTo} at ${confTarget}% — lower the confidence target, spending, or check contributions.`}
              </p>
            </div>
          ) : (
            <>
              <div className="w-36">
                <NumberInput label="Retire at age" value={s.targetRetirementAge ?? 55} min={s.currentAge} max={planTo} onChange={v => update({ targetRetirementAge: v })} />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">Confidence {isRecomputing && <Spinner label="Calculating…" />}</p>
                <p className={`text-3xl font-bold tabular-nums ${confidenceColor(confidence)}`}>
                  {confidence != null ? `${(confidence * 100).toFixed(0)}%` : awaitingFirst ? '…' : '—'}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">chance your money lasts to {planTo} retiring at {chosenAge}</p>
              </div>
            </>
          )}
        </div>

        {sensitivity && (
          <div className="flex flex-wrap gap-2 mt-4">
            <span className="text-xs bg-slate-900/70 border border-slate-700 rounded-full px-3 py-1 text-slate-300 tabular-nums">
              Retire 1 yr later → {(sensitivity.later * 100).toFixed(0)}%
            </span>
            <span className="text-xs bg-slate-900/70 border border-slate-700 rounded-full px-3 py-1 text-slate-300 tabular-nums">
              Spend £2k/yr less → {(sensitivity.lessSpend * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Confidence-vs-age curve */}
      {curve.length > 1 && (
        <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-semibold text-slate-100 flex items-center gap-2">Confidence by retirement age {isRecomputing && <Spinner />}</h3>
          <p className="text-xs text-slate-600 mt-0.5 mb-3">Chance your money lasts to {planTo}, by the age you stop working</p>
          {curveChart}
        </div>
      )}

      {/* Monte Carlo */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-100 flex items-center gap-2">Market risk {isRecomputing && <Spinner />}</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {mc
                ? `${mc.runs.toLocaleString()} simulated market histories at ${(s.returnVolatility ?? 15).toFixed(0)}% volatility, retiring at ${headlineAge?.toFixed(1)}`
                : 'Needs a reachable FIRE age to simulate'}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-bold tabular-nums ${confidenceColor(confidence)}`}>
              {confidence != null ? `${(confidence * 100).toFixed(0)}%` : '—'}
            </p>
            <p className="text-xs text-slate-500">chance your money lasts to {planTo}</p>
          </div>
        </div>
        {mc && mc.bands.length > 1 && (
          <div className="mt-4">
            {marketChart}
            <p className="text-xs text-slate-600 mt-2">
              The median sits below the deterministic projection by design — volatility drags compound growth. A path fails if the ISA/GIA pot empties before pension access, or everything empties before {planTo}.
            </p>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-100">Projection</h3>
            <p className="text-xs text-slate-600 mt-0.5">All values in today's money · ~{(s.expectedAnnualReturn - s.inflationRate).toFixed(1)}% real return · smooth-market retirement at {smoothAge != null ? smoothAge.toFixed(1) : '—'}</p>
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
        {projectionChart}
      </div>

      {/* Year-by-year table */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="px-5 py-3 flex items-baseline justify-between border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-100 text-sm">Year-by-year</h3>
          <p className="text-xs text-slate-600">All values in today's money</p>
        </div>
        {yearTable}
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
