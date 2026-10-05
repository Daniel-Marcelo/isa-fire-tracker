import { Link } from 'react-router-dom';
import type { AppData } from '../types';
import { ContributionDeltaChip, Spinner, confidenceColor, useFireCalc } from './useFireCalc';

interface Props { data: AppData; rawData: AppData; onChange: (data: AppData) => void; pricesStale: boolean; }

export default function PlanScreen({ data, rawData, onChange, pricesStale }: Props) {
  const f = useFireCalc(data, rawData, onChange);
  return <div className="space-y-4">
    {pricesStale && <p className="text-xs text-amber-400">Prices may be stale</p>}
    <div className={`rounded-xl p-5 border bg-slate-800/70 border-green-800/30 ${f.isRecomputing && f.calc ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex gap-0.5 bg-slate-900 rounded-lg p-1">{([['earliest', 'Earliest age'], ['fixedAge', 'Chosen age']] as const).map(([m, label]) => <button key={m} onClick={() => f.update({ fireMode: m })} className={`px-3 py-1 rounded-md text-sm font-medium ${f.mode === m ? 'bg-slate-700 text-slate-100' : 'text-slate-500'}`}>{label}</button>)}</div>
        {f.isRecomputing && f.calc && <Spinner label="Calculating…" />}
      </div>
      {f.mode === 'earliest' ? <div>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">FIRE age</p>
        <p className="text-3xl font-bold text-slate-50 tabular-nums">{f.solvedAge != null ? `Age ${f.solvedAge.toFixed(1)}` : f.awaitingFirst && f.calcError ? "Couldn't compute" : f.awaitingFirst ? '…' : '—'}</p>
        <p className="text-xs text-slate-600 mt-0.5">{f.solvedAge != null ? `Earliest retirement with ≥${f.confTarget}% confidence` : f.awaitingFirst && f.calcError ? "Couldn't compute a projection — check your inputs." : f.awaitingFirst ? 'Estimating your earliest retirement age…' : f.degenerateHorizon ? 'Plan-to age must be beyond your current age' : `Not reachable by ${f.planTo} at ${f.confTarget}%`}</p>
        {f.solvedAge != null && f.requiredContribution != null && <p className="text-xs text-indigo-300/80 mt-1.5">Saving {f.fmt(f.requiredContribution)}/mo total would sustain retirement. <ContributionDeltaChip current={f.currentTotalContribution} required={f.requiredContribution} fmt={f.fmt} /></p>}
      </div> : <div className="flex flex-wrap gap-6">
        <div><p className="text-xs text-slate-500 uppercase">Confidence</p><p className={`text-3xl font-bold ${confidenceColor(f.confidence)}`}>{f.confidence != null ? `${(f.confidence * 100).toFixed(0)}%` : f.awaitingFirst && f.calcError ? "Couldn't compute" : f.awaitingFirst ? '…' : '—'}</p><p className="text-xs text-slate-600">{f.awaitingFirst && f.calcError ? "Couldn't compute a projection — check your inputs." : `chance your money lasts to ${f.planTo} retiring at ${f.chosenAge}`}</p></div>
        <div><p className="text-xs text-slate-500 uppercase">Required saving</p><p className="text-3xl font-bold text-slate-50">{f.awaitingFirst ? (f.calcError ? "Couldn't compute" : '…') : f.requiredContribution == null ? '—' : `${f.fmt(f.requiredContribution)}/mo`}</p><p className="text-xs text-slate-600">{f.awaitingFirst ? (f.calcError ? "Couldn't compute a projection — check your inputs." : 'Estimating your required saving…') : f.requiredContribution == null ? `Not reachable at ${f.chosenAge} by saving alone — push the age out or trim spending.` : f.requiredContribution === 0 ? `Your current pots already clear ${f.confTarget}% — no further saving required.` : `total monthly saving to retire at ${f.chosenAge} with ≥${f.confTarget}% confidence`}</p>{!f.awaitingFirst && f.requiredContribution != null && <ContributionDeltaChip current={f.currentTotalContribution} required={f.requiredContribution} fmt={f.fmt} />}</div>
      </div>}
      {f.sensitivity && <div className="flex flex-wrap gap-2 mt-4"><span className="text-xs bg-slate-900/70 border border-slate-700 rounded-full px-3 py-1 text-slate-300 tabular-nums">Retire 1 yr later → {(f.sensitivity.later * 100).toFixed(0)}%</span><span className="text-xs bg-slate-900/70 border border-slate-700 rounded-full px-3 py-1 text-slate-300 tabular-nums">Spend £2k/yr less → {(f.sensitivity.lessSpend * 100).toFixed(0)}%</span></div>}
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{([['Cash', f.pots.cash, 'text-teal-400'], ['ISA', f.pots.isa, 'text-indigo-400'], ['GIA', f.pots.gia, 'text-amber-400'], ['Pension', f.pensionValue, 'text-violet-400']] as const).map(([label, value, color]) => <div key={label} className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><p className={`text-xs font-medium uppercase tracking-wide mb-1 ${color}`}>{label}</p><p className="text-2xl font-bold text-slate-50 tabular-nums">{f.fmt(value)}</p></div>)}</div>
    <Link to="/fire/adjust" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">Adjust plan</Link>
    {f.curve.length > 1 && <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><h3 className="font-semibold text-slate-100">Confidence by retirement age</h3>{f.curveChart}</div>}
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><h3 className="font-semibold text-slate-100">Market risk {f.isRecomputing && <Spinner />}{f.calcError && f.calc && <span className="text-[10px] text-slate-600 ml-2">computed on this device</span>}</h3><p className="text-xs text-slate-600">Chance your money lasts to {f.planTo}</p>{f.mc && f.mc.bands.length > 1 && f.marketChart}</div>
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><div className="flex items-center justify-between mb-4"><div><h3 className="font-semibold text-slate-100">Projection</h3><p className="text-xs text-slate-600">All values in today's money</p></div><div className="flex gap-1">{(['split', 'combined'] as const).map(t => <button key={t} onClick={() => f.setActiveTab(t)} className={`px-3 py-1 rounded-md text-sm ${f.activeTab === t ? 'bg-slate-700 text-slate-100' : 'text-slate-500'}`}>{t === 'split' ? 'Split' : 'Combined'}</button>)}</div></div>{f.projectionChart}</div>
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden"><div className="px-5 py-3 border-b border-slate-700/50"><h3 className="font-semibold text-slate-100 text-sm">Year-by-year</h3></div>{f.yearTable}</div>
  </div>;
}
