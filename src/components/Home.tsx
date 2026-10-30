import { Link } from 'react-router-dom';
import type { AppData } from '../types';
import { getCurrentTaxYearContribution } from '../store';
import { ISA_ANNUAL_ALLOWANCE } from '../utils';
import { portfolioSummary } from '../lib/portfolioSummary';
import { withdrawalRateOf } from '../lib/fireEngine';
import { usePlan } from './usePlan';
import IncomeSummaryCard from './IncomeSummaryCard';

interface Props {
  data: AppData;
  gbpData: AppData;
  rawData: AppData;
  onChange: (data: AppData) => void;
  pricesUpdatedAt: Date | null;
  pricesStale: boolean;
  fmt: (v: number) => string;
  fmtShort: (v: number) => string;
}

export default function Home({ data, gbpData, rawData, onChange, pricesUpdatedAt, pricesStale, fmt, fmtShort }: Props) {
  const summary = portfolioSummary(data);
  const used = getCurrentTaxYearContribution(data);
  const remaining = ISA_ANNUAL_ALLOWANCE - used;
  const allowancePct = (used / ISA_ANNUAL_ALLOWANCE) * 100;
  const allowanceBarColor = allowancePct > 100
    ? 'bg-red-500'
    : allowancePct >= 90
      ? 'bg-amber-400'
      : 'bg-indigo-500';
  const plan = usePlan(gbpData, rawData, onChange);
  const { retireAge } = plan;
  const withdrawalRate = withdrawalRateOf(data.fireSettings) / 100;

  return (
    <div className="space-y-4">
      {summary.hasAccounts ? (
        <>
          <div>
            <p className="text-sm text-slate-400">Total portfolio</p>
            <p className="text-3xl font-bold text-slate-50 tabular-nums">{fmt(summary.total)}</p>
            <p className={`text-sm mt-1 tabular-nums ${summary.gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {summary.gain >= 0 ? '+' : ''}{fmt(summary.gain)} · {summary.gain >= 0 ? '+' : ''}{summary.gainPct.toFixed(1)}%
            </p>
            <p className="text-sm text-slate-400 mt-2">
              {fmtShort(summary.accessible)} accessible · {fmtShort(summary.pension)} pension
            </p>
          </div>
        </>
      ) : (
        <div>
          <p className="text-3xl font-bold text-slate-50 tabular-nums">{fmt(0)}</p>
          <Link to="/holdings/new" className="inline-block text-sm text-indigo-400 hover:text-indigo-300 mt-2">
            Add an account
          </Link>
        </div>
      )}

      <div className="text-sm text-slate-400">
        <p>{pricesUpdatedAt ? `Prices updated ${pricesUpdatedAt.toLocaleTimeString()}` : 'Prices'}</p>
        {pricesStale && <p className="text-amber-400">Prices may be stale</p>}
      </div>

      {summary.total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IncomeSummaryCard
            label={`${(withdrawalRate * 100).toFixed(1)}% SWR — safe annual withdrawal`}
            value={summary.total * withdrawalRate}
            sub="Withdraw this each year indefinitely (Trinity Study)"
            accessibleValue={summary.accessible * withdrawalRate}
            pensionValue={summary.pension * withdrawalRate}
            fmt={fmt}
            fmtShort={fmtShort}
          />
          <IncomeSummaryCard
            label="8% return — estimated annual earnings"
            value={summary.total * 0.08}
            sub={`At 8% growth rate · ${fmtShort(summary.total * 0.08 / 12)}/mo`}
            accessibleValue={summary.accessible * 0.08}
            pensionValue={summary.pension * 0.08}
            fmt={fmt}
            fmtShort={fmtShort}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {(summary.hasAccounts || data.fireSettings) && (
          <Link to="/fire" className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-4 block">
            <p className="text-sm text-slate-400">{plan.mode === 'fixedAge' ? 'Retire at' : 'FIRE age'}</p>
            <p className="text-2xl font-bold text-slate-50 tabular-nums mt-2">
              {retireAge == null ? '—' : retireAge}
            </p>
            {plan.mode === 'fixedAge' && plan.result.depletedAge != null && (
              <p className="text-xs text-slate-500 mt-1">runs out at {plan.result.depletedAge}</p>
            )}
          </Link>
        )}

        {(summary.hasAccounts || (data.contributions ?? []).length > 0) && (
          <Link to="/allowance" className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-4 block">
            <p className="text-sm text-slate-400">ISA left</p>
            <p className="text-2xl font-bold text-slate-50 tabular-nums mt-2">
              {fmt(remaining)}
            </p>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mt-3">
              <div
                className={`h-full rounded-full ${allowanceBarColor}`}
                style={{ width: `${Math.min(100, allowancePct)}%` }}
              />
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
