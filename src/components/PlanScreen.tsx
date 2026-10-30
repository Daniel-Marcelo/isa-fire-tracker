import { Link } from 'react-router-dom';
import type { AppData } from '../types';
import { formatYearRanges } from '../lib/historicalBacktest';
import { ContributionDeltaChip, Spinner, confidenceColor, useFireCalc } from './useFireCalc';

interface Props { data: AppData; rawData: AppData; onChange: (data: AppData) => void; pricesStale: boolean; }

const pct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
const chip = 'text-xs bg-slate-900/70 border border-slate-700 rounded-full px-3 py-1 text-slate-300 tabular-nums';

export default function PlanScreen({ data, rawData, onChange, pricesStale }: Props) {
  const f = useFireCalc(data, rawData, onChange);
  const realRate = (f.s.expectedAnnualReturn - f.s.inflationRate).toFixed(1);
  const n = f.fireNumber;
  const bt = f.backtest;
  return <div className="space-y-4">
    {pricesStale && <p className="text-xs text-amber-400">Prices may be stale</p>}

    <div className="rounded-xl p-5 border bg-slate-800/70 border-slate-700/50">
      <div className="flex gap-0.5 bg-slate-900 rounded-lg p-1 w-fit mb-4">{([['earliest', 'Earliest age'], ['fixedAge', 'Chosen age']] as const).map(([m, label]) => <button key={m} onClick={() => f.update({ fireMode: m })} className={`px-3 py-1 rounded-md text-sm font-medium ${f.mode === m ? 'bg-slate-700 text-slate-100' : 'text-slate-500'}`}>{label}</button>)}</div>
      {f.mode === 'earliest' ? <div>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">FIRE age</p>
        <p className="text-3xl font-bold text-slate-50 tabular-nums">{f.retireAge != null ? `Age ${f.retireAge}` : '—'}</p>
        <p className="text-xs text-slate-600 mt-0.5">{f.degenerateHorizon ? 'Plan-to age must be beyond your current age' : f.retireAge != null ? `Earliest age your money lasts to ${f.planTo} at a steady ~${realRate}% real return` : `Not reachable by ${f.planTo} at a steady ~${realRate}% real return`}</p>
      </div> : <div className="flex flex-wrap gap-6">
        <div><p className="text-xs text-slate-500 uppercase">Retire at {f.chosenAge}</p><p className="text-3xl font-bold text-slate-50 tabular-nums">{f.result.depletedAge == null ? `Lasts to ${f.planTo}` : `Runs out at ${f.result.depletedAge}`}</p><p className="text-xs text-slate-600">at a steady ~{realRate}% real return</p></div>
        <div><p className="text-xs text-slate-500 uppercase">Required saving</p><p className="text-3xl font-bold text-slate-50 tabular-nums">{f.requiredSaving == null ? '—' : `${f.fmt(f.requiredSaving)}/mo`}</p><p className="text-xs text-slate-600">{f.requiredSaving == null ? `Saving alone can't make ${f.chosenAge} work — push the age out or trim spending.` : f.requiredSaving === 0 ? 'Your current pots already last — no further saving needed.' : `total monthly saving for your money to last to ${f.planTo}`}</p>{f.requiredSaving != null && <ContributionDeltaChip current={f.currentTotalContribution} required={f.requiredSaving} fmt={f.fmt} />}</div>
      </div>}
    </div>

    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">FIRE number</p>
      <p className="text-3xl font-bold text-slate-50 tabular-nums">{f.fmt(n.target)}</p>
      <p className="text-xs text-slate-600 mt-0.5">{f.fmt(f.s.annualExpensesInRetirement)}/yr ÷ {(n.withdrawalRate * 100).toFixed(1)}% withdrawal rate{n.statePensionAge != null && ` · ${f.fmt(n.targetWithStatePension)} once the state pension starts at ${n.statePensionAge}`}</p>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mt-4"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, n.progress * 100)}%` }} /></div>
      <p className="text-xs text-slate-400 mt-2 tabular-nums">{(n.progress * 100).toFixed(0)}% there · {f.fmt(n.invested)} supports {f.fmt(n.safeIncomeToday)}/yr today</p>
      {n.pension > 0 && <p className="text-xs text-slate-600 mt-1">{f.fmt(n.pension)} of that is pension, locked until {f.pensionAccessAge}.</p>}
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{([['Cash', f.pots.cash, 'text-teal-400'], ['ISA', f.pots.isa, 'text-indigo-400'], ['GIA', f.pots.gia, 'text-amber-400'], ['Pension', f.pots.pension, 'text-violet-400']] as const).map(([label, value, color]) => <div key={label} className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><p className={`text-xs font-medium uppercase tracking-wide mb-1 ${color}`}>{label}</p><p className="text-2xl font-bold text-slate-50 tabular-nums">{f.fmt(value)}</p></div>)}</div>
    <Link to="/fire/adjust" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">Adjust plan</Link>

    <div className={`bg-slate-800/70 rounded-xl border border-slate-700/50 p-5 ${f.isRecomputing && f.calc ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-100">Market check{f.retireAge != null && ` — retiring at ${f.retireAge}`}</h3>{f.isRecomputing && f.retireAge != null && <Spinner label="Calculating…" />}</div>
      <p className="text-xs text-slate-600">The plan above assumes the same return every year. This replays real and random market sequences against it.</p>
      {f.retireAge == null ? <p className="text-sm text-slate-400 mt-4">Nothing to test until the plan reaches a retirement age.</p> : f.awaitingFirst ? <p className="text-sm text-slate-400 mt-4">{f.calcError ? "Couldn't run the market check — check your inputs." : 'Running the market check…'}</p> : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-xs text-slate-500 uppercase">Historical</p>
            <p className={`text-3xl font-bold tabular-nums ${confidenceColor(bt && bt.cycles > 0 ? bt.successRate : null)}`}>{bt && bt.cycles > 0 ? pct(bt.successRate) : '—'}</p>
            {bt && bt.cycles > 0 && <p className="text-xs text-slate-600">lasted in {bt.cycles - bt.failedStartYears.length} of {bt.cycles} start years, {bt.firstYear}–{bt.lastYear} (US stocks)</p>}
            {bt && bt.failedStartYears.length > 0 && <p className="text-xs text-slate-400 mt-1">Ran out if this plan had begun in {formatYearRanges(bt.failedStartYears)}</p>}
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase">Simulated</p>
            <p className={`text-3xl font-bold tabular-nums ${confidenceColor(f.confidence)}`}>{f.confidence != null ? pct(f.confidence) : '—'}</p>
            {f.mc && f.confidence != null && <p className="text-xs text-slate-600">lasted in {pct(f.confidence)} of {f.mc.runs} random markets at {f.s.returnVolatility ?? 15}% volatility</p>}
          </div>
        </div>
        {f.sensitivity && <div className="flex flex-wrap gap-2 mt-4"><span className={chip}>Simulated, retire 1 yr later → {pct(f.sensitivity.later)}</span><span className={chip}>Simulated, spend £2k/yr less → {pct(f.sensitivity.lessSpend)}</span></div>}
        {f.calcError && <p className="text-[10px] text-slate-600 mt-2">computed on this device</p>}
        {f.mc && f.mc.bands.length > 1 && <div className="mt-4"><p className="text-xs text-slate-500 mb-2">Simulated wealth: 10th percentile, median, 90th percentile</p>{f.marketChart}</div>}
      </>}
    </div>

    {f.curve.length > 1 && <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><h3 className="font-semibold text-slate-100">Simulated chance by retirement age</h3><p className="text-xs text-slate-600">Dashed line is your {f.confTarget}% target</p>{f.curveChart}</div>}
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5"><div className="flex items-center justify-between mb-4"><div><h3 className="font-semibold text-slate-100">Projection</h3><p className="text-xs text-slate-600">Steady ~{realRate}% real return · today's money</p></div><div className="flex gap-1">{(['split', 'combined'] as const).map(t => <button key={t} onClick={() => f.setActiveTab(t)} className={`px-3 py-1 rounded-md text-sm ${f.activeTab === t ? 'bg-slate-700 text-slate-100' : 'text-slate-500'}`}>{t === 'split' ? 'Split' : 'Combined'}</button>)}</div></div>{f.projectionChart}</div>
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden"><div className="px-5 py-3 border-b border-slate-700/50"><h3 className="font-semibold text-slate-100 text-sm">Year-by-year</h3></div>{f.yearTable}</div>
  </div>;
}
