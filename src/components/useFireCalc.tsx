import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AreaChart, Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import type { AppData, FireSettings } from '../types';
import { formatCurrency, formatCurrencyShort } from '../utils';
import { project } from '../lib/fireProjection';
import { planToAgeOf, potsFromProviders, targetConfidenceOf } from '../lib/fireEngine';
import { runFireCalc, type FireCalcRequest, type FireCalcResult } from '../lib/fireCalc';

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', color: '#f8fafc', fontSize: 12, padding: '8px 12px' },
  labelStyle: { color: '#94a3b8', marginBottom: 4 },
  itemStyle: { color: '#cbd5e1' },
};

export function confidenceColor(rate: number | null): string {
  if (rate == null) return 'text-slate-600';
  if (rate >= 0.9) return 'text-green-400';
  if (rate >= 0.75) return 'text-amber-400';
  return 'text-red-400';
}

export function Spinner({ label }: { label?: string }) {
  return <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-indigo-400 normal-case tracking-normal"><span className="inline-block w-3 h-3 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin" />{label}</span>;
}

export function ContributionDeltaChip({ current, required, fmt }: { current: number; required: number; fmt: (v: number) => string }) {
  const delta = required - current;
  const cls = "text-xs bg-slate-900/70 border border-slate-700 rounded-full px-3 py-1 text-slate-300 tabular-nums";
  if (Math.abs(delta) < 5) return <span className={cls}>same as today</span>;
  return <span className={cls}>{delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))}/mo {delta > 0 ? 'more' : 'less'} than today</span>;
}

export function NumberInput({ label, value, min, max, step = 1, prefix, suffix, hint, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; prefix?: string; suffix?: string; hint?: string; onChange: (v: number) => void;
}) {
  return <div>
    {label && <label className="block text-sm font-medium text-slate-400 mb-1.5">{label}</label>}
    <div className="relative">
      {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{prefix}</span>}
      <input type="number" className={`w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums text-sm transition-colors ${prefix ? 'pl-7 pr-4' : suffix ? 'pl-4 pr-7' : 'px-4'}`} value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{suffix}</span>}
    </div>
    {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
  </div>;
}

function TextTooltip({ children, text, className }: { children: ReactNode; text: string; className?: string }) {
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  return <><span className={`cursor-help ${className ?? ''}`} onMouseEnter={e => setTipPos({ x: e.clientX, y: e.clientY })} onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })} onMouseLeave={() => setTipPos(null)}>{children}</span>{tipPos && <div className="fixed z-[9999] pointer-events-none" style={{ left: tipPos.x + 12, top: tipPos.y - 8 }}><div className="bg-slate-800 text-slate-300 rounded-xl shadow-2xl px-3 py-2 text-xs border border-slate-700 max-w-[260px]">{text}</div></div>}</>;
}

function Delta({ v, breakdown }: { v: number; breakdown: { from: number; interest: number; contributed: number; withdrawn: number; to: number; rateLabel: string; isFire?: boolean } }) {
  const positive = v >= 0;
  const fmt = (n: number) => n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
  const fmtShort = (n: number) => Math.abs(n) >= 1_000_000 ? `£${(n / 1_000_000).toFixed(2)}m` : Math.abs(n) >= 1_000 ? `£${(n / 1_000).toFixed(1)}k` : `£${n.toFixed(0)}`;
  const rows = [{ label: 'Previous', value: fmt(breakdown.from) }, { label: `Growth (${breakdown.rateLabel})`, value: `+${fmt(breakdown.interest)}`, color: 'text-green-400' }, ...(breakdown.contributed ? [{ label: breakdown.isFire ? 'Final year savings' : 'Contributions', value: `+${fmt(breakdown.contributed)}`, color: 'text-indigo-400' }] : []), ...(breakdown.withdrawn ? [{ label: 'Withdrawn', value: `-${fmt(breakdown.withdrawn)}`, color: 'text-red-400' }] : []), { label: 'New total', value: fmt(breakdown.to), color: 'text-slate-100 font-semibold' }];
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  return <><span className={`ml-1 text-xs cursor-help tabular-nums ${positive ? 'text-green-400/70' : 'text-red-400/70'}`} onMouseEnter={e => setTipPos({ x: e.clientX, y: e.clientY })} onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })} onMouseLeave={() => setTipPos(null)}>({positive ? '+' : ''}{fmtShort(v)})</span>{tipPos && <div className="fixed z-[9999] pointer-events-none" style={{ left: tipPos.x + 12, top: tipPos.y - 8 }}><div className="bg-slate-800 text-slate-300 rounded-xl shadow-2xl p-3 min-w-[220px] text-xs border border-slate-700"><table className="w-full border-separate" style={{ borderSpacing: '0 2px' }}><tbody>{rows.map((row, i) => <tr key={i}><td className="text-slate-500 pr-4 whitespace-nowrap">{row.label}</td><td className={`text-right font-mono whitespace-nowrap tabular-nums ${row.color ?? 'text-slate-300'}`}>{row.value}</td></tr>)}</tbody></table></div></div>}</>;
}

export function useFireCalc(data: AppData, rawData: AppData, onChange: (data: AppData) => void) {
  const s = data.fireSettings;
  const fmt = useCallback((v: number) => formatCurrency(v, 'GBP'), []);
  const fmtShort = useCallback((v: number) => formatCurrencyShort(v, 'GBP'), []);
  const [activeTab, setActiveTab] = useState<'split' | 'combined'>('split');
  const update = useCallback((patch: Partial<FireSettings>) => onChange({ ...rawData, fireSettings: { ...rawData.fireSettings, ...patch } }), [onChange, rawData]);
  const pots = useMemo(() => potsFromProviders(data.providers), [data.providers]);
  const pensionValue = pots.pension;
  const mode = s.fireMode ?? 'earliest';
  const planTo = planToAgeOf(s);
  const confTarget = targetConfidenceOf(s);
  const degenerateHorizon = planTo <= s.currentAge + 1;
  const statePensionOn = s.statePensionEnabled ?? true;
  const statePensionAge = s.statePensionAge ?? 67;
  const pensionAccessAge = s.pensionAccessAge ?? 57;
  const ds = useDeferredValue(s);
  const result = useMemo(() => project(ds, pots), [ds, pots]);
  const smoothAge = result.earlyFireAge ?? result.fullFireAge;
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const [calc, setCalc] = useState<FireCalcResult | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(true);
  const [calcError, setCalcError] = useState(false);
  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    setIsRecomputing(true);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      workerRef.current?.terminate();
      const id = ++reqIdRef.current;
      let settled = false;
      const fallback = () => setTimeout(() => {
        if (id !== reqIdRef.current) return;
        try { setCalc(runFireCalc({ id, settings: s, pots })); setCalcError(true); }
        catch { setCalcError(true); }
        finally { setIsRecomputing(false); }
      }, 0);
      try {
        const w = new Worker(new URL('../lib/fireWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = w;
        w.onmessage = (e: MessageEvent<FireCalcResult>) => {
          if (e.data.id !== id || settled) return;
          settled = true; clearTimeout(watchdog); setCalc(e.data); setCalcError(false); setIsRecomputing(false);
        };
        w.onerror = () => { if (settled) return; settled = true; clearTimeout(watchdog); w.terminate(); fallback(); };
        watchdog = setTimeout(() => { if (settled) return; settled = true; w.terminate(); fallback(); }, 8000);
        const req: FireCalcRequest = { id, settings: s, pots };
        w.postMessage(req);
      } catch { fallback(); }
    }, 300);
    return () => { clearTimeout(t); clearTimeout(watchdog); };
  }, [s, pots]);
  const solvedAge = calc?.solvedAge ?? null;
  const chosenAge = Math.min(Math.max(s.targetRetirementAge ?? 55, s.currentAge), planTo);
  const headlineAge = calc?.headlineAge ?? null;
  const mc = calc?.mc ?? null;
  const confidence = mc && mc.runs > 0 ? mc.successRate : null;
  const curve = calc?.curve ?? [];
  const sensitivity = calc?.sensitivity ?? null;
  const requiredContribution = calc?.requiredContribution ?? null;
  const currentTotalContribution = s.monthlyContribution + (s.monthlyPensionContribution ?? 0);
  const awaitingFirst = calc == null;
  const curveChart = useMemo(() => (
    <ResponsiveContainer width="100%" height={220}><ComposedChart data={curve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="age" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11, fill: '#64748b' }} tickCount={10} /><YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `${v}%`} width={45} />
      <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Confidence']} labelFormatter={l => `Retire at ${l}`} />
      <ReferenceLine y={confTarget} stroke="#facc15" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: `${confTarget}% target`, fill: '#facc15', fontSize: 10, position: 'insideBottomLeft' }} />
      {headlineAge != null && <ReferenceLine x={headlineAge} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} />}
      <Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2} dot={false} name="Confidence" />
    </ComposedChart></ResponsiveContainer>
  ), [curve, confTarget, headlineAge]);
  const marketChart = useMemo(() => (
    <ResponsiveContainer width="100%" height={220}><ComposedChart data={mc?.bands ?? []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="age" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={fmtShort} width={70} />
      <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmt(Number(v))} labelFormatter={l => `Age ${l}`} /><ReferenceLine x={pensionAccessAge} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} />
      {statePensionOn && <ReferenceLine x={statePensionAge} stroke="#2dd4bf" strokeDasharray="4 3" strokeOpacity={0.6} />}{headlineAge != null && <ReferenceLine x={Math.round(headlineAge)} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} />}
      <Line type="monotone" dataKey="p90" stroke="#34d399" strokeWidth={1} dot={false} strokeOpacity={0.6} name="90th percentile" /><Line type="monotone" dataKey="p50" stroke="#6366f1" strokeWidth={2} dot={false} name="Median" /><Line type="monotone" dataKey="p10" stroke="#f87171" strokeWidth={1} dot={false} strokeOpacity={0.7} name="10th percentile" /><Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
    </ComposedChart></ResponsiveContainer>
  ), [mc, statePensionOn, statePensionAge, headlineAge, pensionAccessAge, fmt, fmtShort]);
  const projectionChart = useMemo(() => (
    <ResponsiveContainer width="100%" height={300}><AreaChart data={result.points} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
      <defs><linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} /></linearGradient><linearGradient id="colorPen" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} /><stop offset="95%" stopColor="#a78bfa" stopOpacity={0} /></linearGradient><linearGradient id="colorCom" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} /><stop offset="95%" stopColor="#4ade80" stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="age" tick={{ fontSize: 11, fill: '#64748b' }} label={{ value: 'Age', position: 'insideBottomRight', offset: -5, fontSize: 11, fill: '#64748b' }} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={fmtShort} width={70} /><Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmt(Number(v))} labelFormatter={l => `Age ${l}`} /><Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
      <ReferenceLine x={pensionAccessAge} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: 'Pension', fill: '#a78bfa', fontSize: 10 }} />{statePensionOn && <ReferenceLine x={statePensionAge} stroke="#2dd4bf" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: 'State pension', fill: '#2dd4bf', fontSize: 10 }} />}{smoothAge != null && <ReferenceLine x={Math.round(smoothAge)} stroke="#4ade80" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: 'FIRE', fill: '#4ade80', fontSize: 10 }} />}
      {activeTab === 'split' ? <><Area type="monotone" dataKey="accessible" stroke="#6366f1" strokeWidth={2} fill="url(#colorAcc)" name="Cash + ISA + GIA" /><Area type="monotone" dataKey="pension" stroke="#a78bfa" strokeWidth={2} fill="url(#colorPen)" name="Pension (SIPP/Workplace)" /></> : <Area type="monotone" dataKey="combined" stroke="#4ade80" strokeWidth={2} fill="url(#colorCom)" name="Combined" />}
    </AreaChart></ResponsiveContainer>
  ), [result, activeTab, statePensionOn, statePensionAge, smoothAge, pensionAccessAge, fmt, fmtShort]);
  const currentYear = new Date().getFullYear();
  const yearTable = useMemo(() => {
    const realRate = (ds.expectedAnnualReturn - ds.inflationRate).toFixed(1);
    const monthlyContribution = ds.monthlyContribution;
    const monthlyPension = ds.monthlyPensionContribution ?? 0;
    return <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-900/60"><tr className="text-xs text-slate-600 uppercase tracking-wider"><th className="text-left px-4 py-3 font-medium">Age</th><th className="text-left px-4 py-3 font-medium">Year</th><th className="text-right px-4 py-3 font-medium text-indigo-400"><TextTooltip text={`ISA & GIA compound at ~${realRate}% real/yr; cash at its own rate. New contributions (£${monthlyContribution.toLocaleString()}/mo) go to the ISA.`} className="border-b border-dashed border-indigo-700">Cash + ISA + GIA</TextTooltip></th><th className="text-right px-4 py-3 font-medium text-violet-400"><TextTooltip text={`Compounds at ~${realRate}% real/yr + £${monthlyPension.toLocaleString()}/mo contributions`} className="border-b border-dashed border-violet-700">Pension</TextTooltip></th><th className="text-right px-4 py-3 font-medium text-slate-400">Combined</th><th className="text-right px-4 py-3 font-medium text-green-400"><TextTooltip text="Pot outflow that year: cash → ISA → GIA (CGT gross-up) → pension after access (tax gross-up), after state pension" className="border-b border-dashed border-green-700">Withdrawn/yr</TextTooltip></th></tr></thead><tbody className="divide-y divide-slate-800">{result.points.map((pt, i) => { const prev = result.points[i - 1]; const year = currentYear + (pt.age - ds.currentAge); const fireAge = result.earlyFireAge ?? result.fullFireAge; const isFireAge = fireAge !== null && pt.age === Math.round(fireAge); const isPensionAccess = pt.age === pensionAccessAge; const isStatePension = statePensionOn && pt.age === statePensionAge; const rateLabel = `~${realRate}% real (${ds.expectedAnnualReturn}% − ${ds.inflationRate}% inflation)`; const isDrawing = isFinite(fireAge ?? Infinity) && (prev ? prev.age >= (fireAge ?? Infinity) : false); const accContributed = !isDrawing ? monthlyContribution * 12 : 0; const penContributed = !isDrawing ? monthlyPension * 12 : 0; const accWithdrawn = pt.accWithdrawn; const penWithdrawn = pt.penWithdrawn; const totalWithdrawn = accWithdrawn + penWithdrawn; const prevAcc = prev?.accessible ?? 0; const prevPen = prev?.pension ?? 0; const prevCom = prev?.combined ?? 0; const accInterest = prev ? pt.accessible - prevAcc + accWithdrawn - accContributed : 0; const penInterest = prev ? pt.pension - prevPen + penWithdrawn - penContributed : 0; const accGrowth = prev ? pt.accessible - prevAcc : null; const penGrowth = prev ? pt.pension - prevPen : null; const comGrowth = prev ? pt.combined - prevCom : null; return <tr key={pt.age} className={`transition-colors ${isFireAge ? 'bg-green-900/15' : isPensionAccess ? 'bg-violet-900/15' : 'hover:bg-slate-700/20'}`}><td className="px-4 py-2.5 font-medium text-slate-200 tabular-nums">{pt.age}{isFireAge && <span className="ml-2 text-xs bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded-full">FIRE</span>}{isPensionAccess && !isFireAge && <span className="ml-2 text-xs bg-violet-900/40 text-violet-400 px-1.5 py-0.5 rounded-full">Pension</span>}{isStatePension && !isFireAge && !isPensionAccess && <span className="ml-2 text-xs bg-teal-900/40 text-teal-400 px-1.5 py-0.5 rounded-full">State pension</span>}</td><td className="px-4 py-2.5 text-slate-600 tabular-nums">{year}</td><td className="px-4 py-2.5 text-right text-indigo-400 tabular-nums">{fmtShort(pt.accessible)}{accGrowth !== null && prev && <Delta v={accGrowth} breakdown={{ from: prevAcc, interest: accInterest, contributed: accContributed, withdrawn: accWithdrawn, to: pt.accessible, rateLabel, isFire: isFireAge }} />}</td><td className="px-4 py-2.5 text-right text-violet-400 tabular-nums">{fmtShort(pt.pension)}{penGrowth !== null && prev && <Delta v={penGrowth} breakdown={{ from: prevPen, interest: penInterest, contributed: penContributed, withdrawn: penWithdrawn, to: pt.pension, rateLabel, isFire: isFireAge }} />}</td><td className="px-4 py-2.5 text-right font-medium text-slate-200 tabular-nums">{fmtShort(pt.combined)}{comGrowth !== null && prev && <Delta v={comGrowth} breakdown={{ from: prevCom, interest: accInterest + penInterest, contributed: accContributed + penContributed, withdrawn: totalWithdrawn, to: pt.combined, rateLabel, isFire: isFireAge }} />}</td><td className="px-4 py-2.5 text-right text-green-400 font-medium tabular-nums">{totalWithdrawn > 0 ? fmtShort(totalWithdrawn) : ''}</td></tr>; })}</tbody></table></div>;
  }, [result, currentYear, ds, statePensionOn, statePensionAge, pensionAccessAge, fmtShort]);
  return { s, update, fmt, fmtShort, mode, pots, pensionValue, solvedAge, confidence, requiredContribution, currentTotalContribution, isRecomputing, awaitingFirst, calcError, headlineAge, curve, sensitivity, mc, calc, result, smoothAge, confTarget, planTo, chosenAge, statePensionOn, statePensionAge, pensionAccessAge, degenerateHorizon, curveChart, marketChart, projectionChart, yearTable, activeTab, setActiveTab };
}
