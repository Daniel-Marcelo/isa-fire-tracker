import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppData } from '../types';
import type { PriceAges } from '../lib/snapshots';
import type { FxRates } from '../lib/fxRates';
import { useCurrency } from '../contexts/CurrencyContext';
import { isPensionType } from '../utils';
import IncomeCard from './IncomeCard';
import AllocationCharts from './AllocationCharts';
import RebalanceCard from './RebalanceCard';
import PerformanceChart from './PerformanceChart';

interface Props {
  data: AppData;
  rawData: AppData;
  onChange: (data: AppData) => void;
  livePrices?: Record<string, number>;
  priceAges?: PriceAges;
  fxRates?: FxRates;
  pricesStale: boolean;
}

const CHIP_CLASS = 'px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors';

export default function HoldingsList({ data, rawData, onChange, fxRates = {}, pricesStale }: Props) {
  const { fmt, fmtShort } = useCurrency();
  const totalValue = data.providers.reduce(
    (sum, provider) => sum + provider.holdings.reduce((value, holding) => value + (holding.currentValue ?? 0), 0),
    0,
  );
  const owners = [...new Set(data.providers.map(provider => provider.owner).filter(Boolean))] as string[];
  const accountTypes = [...new Set(data.providers.map(provider => provider.accountType).filter(Boolean))] as string[];
  const [filterOwner, setFilterOwner] = useFilter('All');
  const [filterType, setFilterType] = useFilter('All');
  const visibleProviders = data.providers.filter(provider =>
    (filterOwner === 'All' || provider.owner === filterOwner) &&
    (filterType === 'All' || provider.accountType === filterType),
  );

  const pensionValue = data.providers
    .filter(provider => isPensionType(provider.accountType))
    .reduce((sum, provider) => sum + provider.holdings.reduce((value, holding) => value + (holding.currentValue ?? 0), 0), 0);
  const accessibleValue = totalValue - pensionValue;
  const withdrawalRate = (data.fireSettings?.withdrawalRate ?? 4) / 100;
  const showCards = totalValue > 0;

  return (
    <div className="space-y-4">
      {pricesStale && <p className="text-xs text-amber-400">Prices may be stale</p>}
      <div className="flex justify-end">
        <Link to="/lookthrough" className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
          Exposure
        </Link>
      </div>

      {(owners.length > 1 || accountTypes.length > 1) && (
        <div className="flex flex-wrap items-center gap-3">
          {owners.length > 1 && (
            <FilterChips label="Owner" values={owners} selected={filterOwner} onSelect={setFilterOwner} />
          )}
          {accountTypes.length > 1 && (
            <FilterChips label="Type" values={accountTypes} selected={filterType} onSelect={setFilterType} />
          )}
        </div>
      )}

      {visibleProviders.length === 0 ? (
        <div className="text-center py-20 text-slate-700">
          <p className="text-base font-medium text-slate-500">No accounts match these filters</p>
        </div>
      ) : (
        visibleProviders.map(provider => {
          const value = provider.holdings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
          const cost = provider.holdings.reduce((sum, holding) => sum + (holding.costBasis ?? 0), 0);
          const gain = value - cost;
          return (
            <Link
              key={provider.id}
              to={`/holdings/${provider.id}`}
              className="block bg-slate-800/70 rounded-xl border border-slate-700/50 p-4 hover:bg-slate-700/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: provider.color }} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-100 truncate">{provider.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {provider.owner && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400">{provider.owner}</span>}
                    {provider.accountType && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-900/40 text-indigo-400">{provider.accountType}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-slate-100 tabular-nums">{fmtShort(value)}</div>
                  {cost > 0 && (
                    <div className={`text-xs mt-0.5 tabular-nums ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {gain >= 0 ? '+' : ''}{fmtShort(gain)}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          );
        })
      )}

      <Link
        to="/holdings/new"
        className="block w-full border border-dashed border-slate-700 rounded-xl py-3 text-center text-sm font-medium text-indigo-400 hover:bg-slate-800 hover:border-indigo-500/50 transition-colors"
      >
        Add account
      </Link>

      {showCards && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IncomeSummaryCard
              label={`${(withdrawalRate * 100).toFixed(1)}% SWR — safe annual withdrawal`}
              value={totalValue * withdrawalRate}
              sub={`Withdraw this each year indefinitely (Trinity Study)`}
              accessibleValue={accessibleValue * withdrawalRate}
              pensionValue={pensionValue * withdrawalRate}
              fmt={fmt}
              fmtShort={fmtShort}
            />
            <IncomeSummaryCard
              label="8% return — estimated annual earnings"
              value={totalValue * 0.08}
              sub={`At 8% growth rate · ${fmtShort(totalValue * 0.08 / 12)}/mo`}
              accessibleValue={accessibleValue * 0.08}
              pensionValue={pensionValue * 0.08}
              fmt={fmt}
              fmtShort={fmtShort}
            />
          </div>
          <IncomeCard data={data} fxRates={fxRates} />
          <AllocationCharts data={data} />
          <RebalanceCard data={data} rawData={rawData} onChange={onChange} />
        </>
      )}

      {data.providers.some(provider => provider.snapshots.length > 1) && (
        <PerformanceChart providers={data.providers} fxRates={fxRates} />
      )}

      {visibleProviders.length > 0 && (
        <AllocationBars providers={visibleProviders} totalValue={totalValue} fmt={fmt} fmtShort={fmtShort} />
      )}
    </div>
  );
}

function useFilter(initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState(initial);
  return [value, setValue];
}

function FilterChips({ label, values, selected, onSelect }: {
  label: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-xs text-slate-600 font-medium uppercase tracking-wide shrink-0 py-1">{label}</span>
      <div className="flex flex-wrap gap-1 min-w-0">
        {['All', ...values].map(value => (
          <button
            key={value}
            onClick={() => onSelect(value)}
            className={`${CHIP_CLASS} ${selected === value ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'}`}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function IncomeSummaryCard({ label, value, sub, accessibleValue, pensionValue, fmt, fmtShort }: {
  label: string;
  value: number;
  sub: string;
  accessibleValue: number;
  pensionValue: number;
  fmt: (value: number) => string;
  fmtShort: (value: number) => string;
}) {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-5">
      <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-slate-50 mt-2 tabular-nums">
        <span className="sm:hidden">{fmtShort(value)}</span>
        <span className="hidden sm:inline">{fmt(value)}</span>
      </p>
      <p className="text-xs text-slate-500 mt-1">{sub}</p>
      <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 gap-2">
        <div><p className="text-xs text-slate-500">ISA / GIA / Cash</p><p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(accessibleValue)}</p></div>
        <div><p className="text-xs text-slate-500">Pension / SIPP</p><p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(pensionValue)}</p></div>
      </div>
    </div>
  );
}

function AllocationBars({ providers, totalValue, fmt, fmtShort }: {
  providers: AppData['providers'];
  totalValue: number;
  fmt: (value: number) => string;
  fmtShort: (value: number) => string;
}) {
  const nameCounts = providers.reduce<Record<string, number>>((counts, provider) => {
    counts[provider.name] = (counts[provider.name] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
      <h3 className="font-semibold text-slate-100 mb-4 text-sm uppercase tracking-wide">Portfolio allocation</h3>
      <div className="space-y-3">
        {providers.map(provider => {
          const value = provider.holdings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
          const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;
          const label = nameCounts[provider.name] > 1 && provider.accountType ? `${provider.name} (${provider.accountType})` : provider.name;
          return (
            <div key={provider.id}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: provider.color }} /><span className="text-slate-300 text-xs">{label}</span></span>
                <span className="text-slate-400 shrink-0 ml-2 tabular-nums text-xs"><span className="sm:hidden">{fmtShort(value)}</span><span className="hidden sm:inline">{fmt(value)}</span>{' '}<span className="text-slate-600">({percentage.toFixed(1)}%)</span></span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${percentage}%`, backgroundColor: provider.color }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

