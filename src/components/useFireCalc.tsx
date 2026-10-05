import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  const curveChart = useMemo(() => <ResponsiveContainer width="100%" height={220}><ComposedChart data={curve}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="age" type="number" /><YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} /><Tooltip {...CHART_TOOLTIP_STYLE} /><ReferenceLine y={confTarget} stroke="#facc15" strokeDasharray="4 3" /><Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2} dot={false} name="Confidence" /></ComposedChart></ResponsiveContainer>, [curve, confTarget]);
  const marketChart = useMemo(() => <ResponsiveContainer width="100%" height={220}><ComposedChart data={mc?.bands ?? []}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="age" /><YAxis tickFormatter={v => fmtShort(Number(v))} /><Tooltip {...CHART_TOOLTIP_STYLE} /><ReferenceLine x={pensionAccessAge} stroke="#a78bfa" strokeDasharray="4 3" /><Line dataKey="p90" stroke="#34d399" dot={false} name="90th percentile" /><Line dataKey="p50" stroke="#6366f1" strokeWidth={2} dot={false} name="Median" /><Line dataKey="p10" stroke="#f87171" dot={false} name="10th percentile" /><Legend /></ComposedChart></ResponsiveContainer>, [mc, pensionAccessAge, fmtShort]);
  const projectionChart = useMemo(() => <ResponsiveContainer width="100%" height={300}><AreaChart data={result.points}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="age" /><YAxis tickFormatter={v => fmtShort(Number(v))} /><Tooltip {...CHART_TOOLTIP_STYLE} /><Legend /><ReferenceLine x={pensionAccessAge} stroke="#a78bfa" strokeDasharray="4 3" />{activeTab === 'split' ? <><Area dataKey="accessible" stroke="#6366f1" fill="#6366f133" name="Cash + ISA + GIA" /><Area dataKey="pension" stroke="#a78bfa" fill="#a78bfa33" name="Pension" /></> : <Area dataKey="combined" stroke="#4ade80" fill="#4ade8033" name="Combined" />}</AreaChart></ResponsiveContainer>, [result, activeTab, pensionAccessAge, fmtShort]);
  const yearTable = useMemo(() => <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-900/60"><tr className="text-xs text-slate-600 uppercase"><th className="text-left px-4 py-3">Age</th><th className="text-right px-4 py-3">Cash + ISA + GIA</th><th className="text-right px-4 py-3">Pension</th><th className="text-right px-4 py-3">Combined</th><th className="text-right px-4 py-3">Withdrawn/yr</th></tr></thead><tbody className="divide-y divide-slate-800">{result.points.map(pt => <tr key={pt.age}><td className="px-4 py-2.5 text-slate-200">{pt.age}</td><td className="px-4 py-2.5 text-right text-indigo-400">{fmtShort(pt.accessible)}</td><td className="px-4 py-2.5 text-right text-violet-400">{fmtShort(pt.pension)}</td><td className="px-4 py-2.5 text-right text-slate-200">{fmtShort(pt.combined)}</td><td className="px-4 py-2.5 text-right text-green-400">{pt.accWithdrawn + pt.penWithdrawn > 0 ? fmtShort(pt.accWithdrawn + pt.penWithdrawn) : ''}</td></tr>)}</tbody></table></div>, [result, fmtShort]);
  return { s, update, fmt, fmtShort, mode, pots, pensionValue, solvedAge, confidence, requiredContribution, currentTotalContribution, isRecomputing, awaitingFirst, calcError, headlineAge, curve, sensitivity, mc, calc, result, smoothAge, confTarget, planTo, chosenAge, statePensionOn, statePensionAge, pensionAccessAge, degenerateHorizon, curveChart, marketChart, projectionChart, yearTable, activeTab, setActiveTab };
}
