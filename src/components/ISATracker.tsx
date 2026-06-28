import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Upload } from 'lucide-react';
import type { AppData, Provider, Holding, AccountType } from '../types';
import { fetchTickerInfo, searchStocks } from '../lib/firebasePrices';
import { uid, PROVIDER_COLORS, getCurrencySymbol } from '../utils';
import { useCurrency } from '../contexts/CurrencyContext';
import { convertAmount, type FxRates } from '../lib/fxRates';
import Modal, { ConfirmModal } from './Modal';
import Dropdown from './Dropdown';
import PerformanceChart from './PerformanceChart';
import AllocationCharts from './AllocationCharts';
import CSVImportModal from './CSVImportModal';
import type { ParsedHolding } from '../lib/csvParsers';


function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

interface Props {
  data: AppData;
  rawData: AppData;
  onChange: (data: AppData) => void;
  livePrices?: Record<string, number>;
  fxRates?: FxRates;
}

export default function ISATracker({ data, rawData, onChange, livePrices = {}, fxRates = {} }: Props) {
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [showAddHolding, setShowAddHolding] = useState<string | null>(null);
  const [editHolding, setEditHolding] = useState<{ providerId: string; holding: Holding } | null>(null);
  const [filterOwner, setFilterOwner] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCSVImport, setShowCSVImport] = useState(false);
  const { fmt, fmtShort, currency: userCurrency } = useCurrency();

  const totalValue = data.providers.reduce(
    (sum, p) => sum + p.holdings.reduce((s, h) => s + h.currentValue ?? 0, 0),
    0
  );

  const totalCostBasis = data.providers.reduce(
    (sum, p) => sum + p.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0),
    0
  );

  const totalGain = totalValue - totalCostBasis;
  const totalGainPct = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0;

const owners = ['All', ...OWNERS] as const;
  const accountTypes = ['All', ...ACCOUNT_TYPES];

  const visibleProviders = data.providers.filter(p => {
    if (filterOwner !== 'All' && p.owner !== filterOwner) return false;
    if (filterType !== 'All' && p.accountType !== filterType) return false;
    return true;
  });

  function toggleExpand(id: string) {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function saveProvider(form: { name: string; owner: string; accountType: AccountType; color: string }, existing?: Provider) {
    vibrate([10, 50, 10]);
    if (existing) {
      onChange({
        ...rawData,
        providers: rawData.providers.map(p =>
          p.id === existing.id ? { ...p, ...form } : p
        ),
      });
    } else {
      const provider: Provider = {
        id: uid(),
        name: form.name,
        owner: form.owner || undefined,
        accountType: form.accountType,
        color: form.color,
        holdings: [],
        snapshots: [],
      };
      onChange({ ...rawData, providers: [...rawData.providers, provider] });
    }
    setShowAddProvider(false);
    setEditProvider(null);
  }

  function deleteProvider(id: string) {
    setConfirmDeleteId(id);
  }

  function confirmDeleteProvider() {
    if (!confirmDeleteId) return;
    vibrate([100]);
    onChange({ ...rawData, providers: rawData.providers.filter(p => p.id !== confirmDeleteId) });
  }

  function saveHolding(providerId: string, form: Omit<Holding, 'id'>, existing?: Holding) {
    vibrate([10, 50, 10]);
    onChange({
      ...rawData,
      providers: rawData.providers.map(p => {
        if (p.id !== providerId) return p;
        const holdings = existing
          ? p.holdings.map(h => h.id === existing.id ? { ...h, ...form } : h)
          : [...p.holdings, { id: uid(), ...form }];
        const totalVal = holdings.reduce((s, h) => {
          const val = h.currentValue ?? h.manualValue ?? 0;
          return s + convertAmount(val, h.currency ?? 'GBP', 'GBP', fxRates);
        }, 0);
        const snapshots = [
          ...p.snapshots.filter(s => s.date !== new Date().toISOString().slice(0, 10)),
          { date: new Date().toISOString().slice(0, 10), totalValue: totalVal },
        ].sort((a, b) => a.date.localeCompare(b.date));
        return { ...p, holdings, snapshots };
      }),
    });
    setShowAddHolding(null);
    setEditHolding(null);
  }

  function handleCSVImport(providerId: string, parsed: ParsedHolding[], mergeMode: 'replace' | 'merge') {
    onChange({
      ...rawData,
      providers: rawData.providers.map(p => {
        if (p.id !== providerId) return p;
        let holdings: Holding[];
        if (mergeMode === 'replace') {
          holdings = parsed.map(ph => ({
            id: uid(),
            name: ph.name,
            ticker: ph.ticker,
            units: ph.units,
            manualValue: ph.costBasis,
            costBasis: ph.costBasis,
          }));
        } else {
          const existing = [...p.holdings];
          for (const ph of parsed) {
            const match = existing.find(h => h.ticker?.toUpperCase() === ph.ticker.toUpperCase());
            if (match) {
              match.units = (match.units ?? 0) + ph.units;
              match.costBasis = (match.costBasis ?? 0) + ph.costBasis;
              match.manualValue = (match.manualValue ?? 0) + ph.costBasis;
            } else {
              existing.push({
                id: uid(),
                name: ph.name,
                ticker: ph.ticker,
                units: ph.units,
                manualValue: ph.costBasis,
                costBasis: ph.costBasis,
              });
            }
          }
          holdings = existing;
        }
        const totalVal = holdings.reduce((s, h) => {
          const val = h.currentValue ?? h.manualValue ?? 0;
          return s + convertAmount(val, h.currency ?? 'GBP', 'GBP', fxRates);
        }, 0);
        const snapshots = [
          ...p.snapshots.filter(s => s.date !== new Date().toISOString().slice(0, 10)),
          { date: new Date().toISOString().slice(0, 10), totalValue: totalVal },
        ].sort((a, b) => a.date.localeCompare(b.date));
        return { ...p, holdings, snapshots, lastCsvImport: new Date().toISOString() };
      }),
    });
  }

  function deleteHolding(providerId: string, holdingId: string) {
    vibrate([50]);
    onChange({
      ...rawData,
      providers: rawData.providers.map(p =>
        p.id === providerId
          ? { ...p, holdings: p.holdings.filter(h => h.id !== holdingId) }
          : p
      ),
    });
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {(() => {
        const PENSION_TYPES = new Set<string>(['SIPP', 'Workplace Pension']);
        const pensionTotal = data.providers
          .filter(p => PENSION_TYPES.has(p.accountType ?? ''))
          .reduce((s, p) => s + p.holdings.reduce((h, holding) => h + holding.currentValue ?? 0, 0), 0);
        const accessibleTotal = totalValue - pensionTotal;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Total portfolio" value={fmtShort(totalValue)} fullValue={fmt(totalValue)} />
            <SummaryCard
              label="Total gain / loss"
              value={fmtShort(totalGain)}
              fullValue={fmt(totalGain)}
              sub={totalCostBasis > 0 ? `${totalGain >= 0 ? '+' : ''}${totalGainPct.toFixed(1)}%` : undefined}
              positive={totalGain >= 0}
              colored
            />
            <SummaryCard label="ISA / GIA" value={fmtShort(accessibleTotal)} fullValue={fmt(accessibleTotal)} sub={totalValue > 0 ? `${((accessibleTotal / totalValue) * 100).toFixed(1)}% of portfolio` : undefined} />
            <SummaryCard label="Pension / SIPP" value={fmtShort(pensionTotal)} fullValue={fmt(pensionTotal)} sub={totalValue > 0 ? `${((pensionTotal / totalValue) * 100).toFixed(1)}% of portfolio` : undefined} />
          </div>
        );
      })()}

      {/* Portfolio income snapshot */}
      {totalValue > 0 && (() => {
        const PENSION_TYPES = new Set<string>(['SIPP', 'Workplace Pension']);
        const pensionValue = data.providers
          .filter(p => PENSION_TYPES.has(p.accountType ?? ''))
          .reduce((s, p) => s + p.holdings.reduce((h, holding) => h + holding.currentValue ?? 0, 0), 0);
        const accessibleValue = totalValue - pensionValue;
        const swr = (data.fireSettings?.withdrawalRate ?? 4) / 100;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-5">
              <p className="text-xs font-medium text-green-400 uppercase tracking-wider">{(swr * 100).toFixed(1)}% SWR — safe annual withdrawal</p>
              <p className="text-2xl sm:text-3xl font-bold text-slate-50 mt-2 tabular-nums">
                <span className="sm:hidden">{fmtShort(totalValue * swr)}</span>
                <span className="hidden sm:inline">{fmt(totalValue * swr)}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">Withdraw this each year indefinitely (Trinity Study)</p>
              <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-slate-500">ISA / GIA</p>
                  <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(accessibleValue * swr)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Pension / SIPP</p>
                  <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(pensionValue * swr)}</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-5">
              <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider">8% return — estimated annual earnings</p>
              <p className="text-2xl sm:text-3xl font-bold text-slate-50 mt-2 tabular-nums">
                <span className="sm:hidden">{fmtShort(totalValue * 0.08)}</span>
                <span className="hidden sm:inline">{fmt(totalValue * 0.08)}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">At 8% growth rate · {fmtShort(totalValue * 0.08 / 12)}/mo</p>
              <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-slate-500">ISA / GIA</p>
                  <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(accessibleValue * 0.08)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Pension / SIPP</p>
                  <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(pensionValue * 0.08)}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Allocation charts */}
      {totalValue > 0 && <AllocationCharts data={data} />}

      {/* Performance chart */}
      {data.providers.some(p => p.snapshots.length > 1) && (
        <PerformanceChart providers={data.providers} fxRates={fxRates} />
      )}

      {/* Providers header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h3 className="font-semibold text-slate-100">Providers</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCSVImport(true)}
            className="flex items-center gap-1.5 border border-slate-700 text-slate-400 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <Upload size={14} />
            <span className="hidden sm:inline">Import CSV</span>
          </button>
          <button
            onClick={() => setShowAddProvider(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">Add Provider</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      {data.providers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 font-medium uppercase tracking-wide">Owner</span>
            <div className="flex gap-1">
              {owners.map(o => (
                <button key={o} onClick={() => setFilterOwner(o)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterOwner === o ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'}`}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 font-medium uppercase tracking-wide">Type</span>
            <div className="flex gap-1">
              {accountTypes.map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterType === t ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {data.providers.length === 0 && (
        <div className="text-center py-20 text-slate-700">
          <p className="text-base font-medium text-slate-500">No providers yet</p>
          <p className="text-sm mt-1 text-slate-600">Add your first ISA provider to get started</p>
        </div>
      )}

      {visibleProviders.map(provider => {
        const providerTotal = provider.holdings.reduce((s, h) => s + h.currentValue ?? 0, 0);
        const providerCost = provider.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
        const gain = providerTotal - providerCost;
        const gainPct = providerCost > 0 ? (gain / providerCost) * 100 : 0;
        const expanded = expandedProviders.has(provider.id);

        return (
          <div key={provider.id} className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden">
            {/* Mobile header */}
            <div
              className="sm:hidden flex flex-col p-4 cursor-pointer hover:bg-slate-700/30 transition-colors"
              onClick={() => toggleExpand(provider.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: provider.color }} />
                  <span className="font-semibold text-slate-100 truncate">{provider.name}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="font-semibold text-slate-100 tabular-nums">{fmtShort(providerTotal)}</span>
                  {expanded ? <ChevronDown size={15} className="text-slate-600 ml-1" /> : <ChevronRight size={15} className="text-slate-600 ml-1" />}
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1.5">
                  {provider.owner && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400">{provider.owner}</span>}
                  {provider.accountType && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-900/40 text-indigo-400">{provider.accountType}</span>}
                  <span className="text-xs text-slate-600">{provider.holdings.length} holdings</span>
                </div>
                {providerCost > 0 && (
                  <div className={`text-xs flex items-center gap-1 tabular-nums ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {gain >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {gain >= 0 ? '+' : ''}{fmtShort(gain)} ({gainPct.toFixed(1)}%)
                  </div>
                )}
              </div>
            </div>

            {/* Desktop header */}
            <div
              className="hidden sm:flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-700/20 transition-colors"
              onClick={() => toggleExpand(provider.id)}
            >
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: provider.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-100">{provider.name}</span>
                  {provider.owner && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400">{provider.owner}</span>
                  )}
                  {provider.accountType && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-900/40 text-indigo-400">{provider.accountType}</span>
                  )}
                </div>
                <span className="text-xs text-slate-600">
                  {provider.holdings.length} holdings
                  {provider.lastCsvImport && (
                    <span className="ml-2" title={`CSV imported on ${new Date(provider.lastCsvImport).toLocaleString()}`}>
                      · CSV {new Date(provider.lastCsvImport).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </span>
              </div>
              <div className="text-right mr-2">
                <div className="font-semibold text-slate-100 tabular-nums">{fmt(providerTotal)}</div>
                {providerCost > 0 && (
                  <div className={`text-xs flex items-center justify-end gap-1 tabular-nums ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {gain >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {gain >= 0 ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={e => { e.stopPropagation(); setEditProvider(provider); }}
                  className="p-1.5 text-slate-600 hover:text-indigo-400 transition-colors"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); deleteProvider(provider.id); }}
                  className="p-1.5 text-slate-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
                {expanded ? <ChevronDown size={15} className="text-slate-600" /> : <ChevronRight size={15} className="text-slate-600" />}
              </div>
            </div>

            {expanded && (
              <div className="border-t border-slate-700/50">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1 sm:hidden">
                      <button
                        onClick={e => { e.stopPropagation(); setEditProvider(provider); }}
                        className="p-1.5 text-slate-600 hover:text-indigo-400 transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteProvider(provider.id); }}
                        className="p-1.5 text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <button
                      onClick={() => setShowAddHolding(provider.id)}
                      className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors ml-auto"
                    >
                      <Plus size={14} /> Add Holding
                    </button>
                  </div>
                  {provider.holdings.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-6">No holdings yet</p>
                  ) : (
                    <>
                      {/* Mobile cards */}
                      <div className="sm:hidden divide-y divide-slate-700/40">
                        {provider.holdings.map(h => {
                          const hGain = h.costBasis != null ? (h.currentValue ?? 0) - h.costBasis : null;
                          const hGainPct = h.costBasis ? (hGain! / h.costBasis) * 100 : null;
                          const hCurrency = h.currency ?? userCurrency;
                          const showNative = hCurrency !== userCurrency && Object.keys(fxRates).length > 0;
                          const toNative = (val: number) => convertAmount(val, userCurrency, hCurrency, fxRates);
                          const nativeSym = getCurrencySymbol(hCurrency);
                          return (
                            <div key={h.id} className="py-3 flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-slate-100 text-sm">{h.name}</div>
                                {h.ticker && <div className="text-xs text-slate-500 mt-0.5 font-mono">{h.ticker}</div>}
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-slate-500">
                                  {h.units != null && <span className="tabular-nums">{h.units.toFixed(4)} units</span>}
                                  {h.currentPrice != null && (
                                    <span className="tabular-nums">@ {fmt(h.currentPrice)}{showNative ? ` (${nativeSym}${toNative(h.currentPrice).toFixed(2)})` : ''}</span>
                                  )}
                                  {h.costBasis != null && <span className="tabular-nums">Cost {fmt(h.costBasis)}</span>}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-medium text-slate-100 text-sm tabular-nums">{fmt(h.currentValue ?? 0)}</div>
                                {showNative && <div className="text-xs text-slate-500 tabular-nums">{nativeSym}{toNative(h.currentValue ?? 0).toFixed(2)}</div>}
                                {hGain != null && (
                                  <div className={`text-xs mt-0.5 tabular-nums ${hGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {hGain >= 0 ? '+' : ''}{fmt(hGain)}
                                    {hGainPct != null && <span className="ml-1">({hGainPct.toFixed(1)}%)</span>}
                                  </div>
                                )}
                                <div className="flex items-center justify-end gap-1 mt-1.5">
                                  <button onClick={() => { const raw = rawData.providers.find(p2 => p2.id === provider.id)?.holdings.find(rh => rh.id === h.id); if (raw) setEditHolding({ providerId: provider.id, holding: raw }); }} className="p-1 text-slate-600 hover:text-indigo-400 transition-colors"><Pencil size={13} /></button>
                                  <button onClick={() => deleteHolding(provider.id, h.id)} className="p-1 text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop table */}
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-slate-600 text-xs uppercase tracking-wider border-b border-slate-700/40">
                              <th className="text-left pb-2 pt-1 font-medium">Name</th>
                              <th className="text-right pb-2 pt-1 font-medium">Units</th>
                              <th className="text-right pb-2 pt-1 font-medium">Price</th>
                              <th className="text-right pb-2 pt-1 font-medium">Value</th>
                              <th className="text-right pb-2 pt-1 font-medium">Cost</th>
                              <th className="text-right pb-2 pt-1 font-medium">Gain</th>
                              <th className="pb-2 pt-1"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/30">
                            {provider.holdings.map(h => {
                              const hGain = h.costBasis != null ? (h.currentValue ?? 0) - h.costBasis : null;
                              const hGainPct = h.costBasis ? (hGain! / h.costBasis) * 100 : null;
                              const hCurrency = h.currency ?? userCurrency;
                              const showNative = hCurrency !== userCurrency && Object.keys(fxRates).length > 0;
                              const toNative = (val: number) => convertAmount(val, userCurrency, hCurrency, fxRates);
                              const nativeSym = getCurrencySymbol(hCurrency);
                              return (
                                <tr key={h.id} className="group hover:bg-slate-700/20 transition-colors">
                                  <td className="py-2.5 pr-4">
                                    <div className="font-medium text-slate-100">{h.name}</div>
                                    {h.ticker && <div className="text-xs text-slate-500 font-mono mt-0.5">{h.ticker}</div>}
                                  </td>
                                  <td className="py-2.5 text-right text-slate-400 tabular-nums">{h.units?.toFixed(4) ?? '—'}</td>
                                  <td className="py-2.5 text-right text-slate-400 tabular-nums">
                                    {h.currentPrice ? fmt(h.currentPrice) : '—'}
                                    {showNative && h.currentPrice != null && (
                                      <div className="text-xs text-slate-600 tabular-nums">{nativeSym}{toNative(h.currentPrice).toFixed(2)}</div>
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right font-medium text-slate-100 tabular-nums">
                                    {fmt(h.currentValue ?? 0)}
                                    {showNative && (
                                      <div className="text-xs text-slate-500 tabular-nums">{nativeSym}{toNative(h.currentValue ?? 0).toFixed(2)}</div>
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right text-slate-500 tabular-nums">
                                    {h.costBasis != null ? fmt(h.costBasis) : '—'}
                                    {showNative && h.costBasis != null && (
                                      <div className="text-xs text-slate-600 tabular-nums">{nativeSym}{toNative(h.costBasis).toFixed(2)}</div>
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right tabular-nums">
                                    {hGain != null ? (
                                      <span className={hGain >= 0 ? 'text-green-400' : 'text-red-400'}>
                                        {hGain >= 0 ? '+' : ''}{fmt(hGain)}
                                        {hGainPct != null && <span className="text-xs ml-1">({hGainPct.toFixed(2)}%)</span>}
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => { const raw = rawData.providers.find(p2 => p2.id === provider.id)?.holdings.find(rh => rh.id === h.id); if (raw) setEditHolding({ providerId: provider.id, holding: raw }); }} className="p-1 text-slate-600 hover:text-indigo-400 transition-colors"><Pencil size={13} /></button>
                                      <button onClick={() => deleteHolding(provider.id, h.id)} className="p-1 text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Portfolio allocation */}
      {visibleProviders.length > 0 && (
        <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-semibold text-slate-100 mb-4 text-sm uppercase tracking-wide">Portfolio allocation</h3>
          <div className="space-y-3">
            {(() => {
              const nameCounts = visibleProviders.reduce<Record<string, number>>((acc, p) => {
                acc[p.name] = (acc[p.name] ?? 0) + 1;
                return acc;
              }, {});
              return visibleProviders.map(p => {
              const val = p.holdings.reduce((s, h) => s + h.currentValue ?? 0, 0);
              const pct = totalValue > 0 ? (val / totalValue) * 100 : 0;
              const label = nameCounts[p.name] > 1 && p.accountType ? `${p.name} (${p.accountType})` : p.name;
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="flex flex-col">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="text-slate-300 text-xs">{label}</span>
                      </span>
                      {(p.accountType || p.owner) && (
                        <span className="flex items-center gap-1.5 mt-1 ml-4">
                          {p.accountType && <span className="px-1.5 py-0.5 text-xs rounded-full bg-indigo-900/40 text-indigo-400 font-medium">{p.accountType}</span>}
                          {p.owner && <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-700 text-slate-500 font-medium">{p.owner}</span>}
                        </span>
                      )}
                    </span>
                    <span className="text-slate-400 shrink-0 ml-2 tabular-nums text-xs">
                      <span className="sm:hidden">{fmtShort(val)}</span>
                      <span className="hidden sm:inline">{fmt(val)}</span>
                      {' '}<span className="text-slate-600">({pct.toFixed(1)}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: p.color }} />
                  </div>
                </div>
              );
            });})()}
          </div>
        </div>
      )}

      {/* Confirm Delete Provider */}
      {confirmDeleteId && (
        <ConfirmModal
          title="Delete provider"
          message="Delete this provider and all its holdings? This cannot be undone."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={confirmDeleteProvider}
          onClose={() => setConfirmDeleteId(null)}
        />
      )}

      {/* CSV Import Modal */}
      {showCSVImport && (
        <CSVImportModal
          providers={data.providers}
          onClose={() => setShowCSVImport(false)}
          onImport={(providerId, parsed, mergeMode) => handleCSVImport(providerId, parsed, mergeMode)}
        />
      )}

      {/* Add/Edit Provider Modal */}
      {(showAddProvider || editProvider) && (
        <ProviderModal
          existing={editProvider ?? undefined}
          usedColors={data.providers.map(p => p.color)}
          onSave={saveProvider}
          onClose={() => { setShowAddProvider(false); setEditProvider(null); }}
        />
      )}

      {/* Add/Edit Holding Modal */}
      {showAddHolding && (
        <HoldingModal
          onSave={form => saveHolding(showAddHolding, form)}
          onClose={() => setShowAddHolding(null)}
          livePrices={livePrices}
        />
      )}
      {editHolding && (
        <HoldingModal
          existing={editHolding.holding}
          onSave={form => saveHolding(editHolding.providerId, form, editHolding.holding)}
          onClose={() => setEditHolding(null)}
          livePrices={livePrices}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, fullValue, sub, positive, colored }: {
  label: string; value: string; fullValue?: string; sub?: string; positive?: boolean; colored?: boolean;
}) {
  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-4 sm:p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${colored ? (positive ? 'text-green-400' : 'text-red-400') : 'text-slate-50'}`}>
        <span className="sm:hidden">{value}</span>
        <span className="hidden sm:inline">{fullValue ?? value}</span>
      </p>
      {sub && <p className={`text-xs mt-0.5 tabular-nums ${positive === undefined ? 'text-slate-600' : positive ? 'text-green-400' : 'text-red-400'}`}>{sub}</p>}
    </div>
  );
}

const ACCOUNT_TYPES: AccountType[] = ['ISA', 'SIPP', 'GIA', 'Workplace Pension'];
const OWNERS = ['Daniel', 'Camilla'] as const;
type Owner = typeof OWNERS[number];

function ProviderModal({ existing, usedColors, onSave, onClose }: {
  existing?: Provider;
  usedColors: string[];
  onSave: (form: { name: string; owner: string; accountType: AccountType; color: string }, existing?: Provider) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [owner, setOwner] = useState<Owner>(existing?.owner as Owner ?? OWNERS[0]);
  const [accountType, setAccountType] = useState<AccountType>(existing?.accountType ?? 'ISA');
  const [color, setColor] = useState(existing?.color ?? PROVIDER_COLORS.find(c => !usedColors.includes(c)) ?? PROVIDER_COLORS[0]);

  return (
    <Modal title={existing ? 'Edit Provider' : 'Add Provider'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Platform name</label>
            <input
              autoFocus
              className="w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600"
              placeholder="e.g. Vanguard, Freetrade, HL…"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Owner</label>
            <Dropdown value={owner} options={OWNERS} onChange={v => setOwner(v as Owner)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Account type</label>
            <Dropdown value={accountType} options={ACCOUNT_TYPES} onChange={setAccountType} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Colour</label>
          <div className="grid grid-cols-10 gap-2">
            {PROVIDER_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-slate-100 scale-110' : 'border-transparent hover:scale-105 hover:border-slate-500'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-slate-700 rounded-xl py-2.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors text-sm">Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={() => onSave({ name: name.trim(), owner: owner.trim(), accountType, color }, existing)}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 font-medium transition-colors disabled:opacity-40 text-sm"
          >
            {existing ? 'Save Changes' : 'Add Provider'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HoldingModal({ existing, onSave, onClose, livePrices = {} }: {
  existing?: Holding;
  onSave: (form: Omit<Holding, 'id'>) => void;
  onClose: () => void;
  livePrices?: Record<string, number>;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [ticker, setTicker] = useState(existing?.ticker ?? '');
  const [nativeCurrency, setNativeCurrency] = useState(existing?.currency ?? 'GBP');
  const [units, setUnits] = useState(existing?.units?.toString() ?? '');
  const [currentPrice, setCurrentPrice] = useState('');
  const [manualValue, setManualValue] = useState(existing?.manualValue?.toString() ?? '');
  const avgCostDefault = existing?.costBasis != null && existing?.units
    ? (existing.costBasis / existing.units).toFixed(4)
    : '';
  const [avgCostPerShare, setAvgCostPerShare] = useState(avgCostDefault);
  const sym = getCurrencySymbol(nativeCurrency);

  const [searchQuery, setSearchQuery] = useState(
    existing ? (existing.ticker ? `${existing.ticker} – ${existing.name}` : existing.name) : ''
  );
  const [searchResults, setSearchResults] = useState<import('../lib/firebasePrices').StockResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [stockSelected, setStockSelected] = useState(!!existing);

  const [fetchedPrice, setFetchedPrice] = useState<number | undefined>(
    existing?.ticker ? livePrices[existing.ticker] : undefined
  );
  const [fetchingPrice, setFetchingPrice] = useState(false);

  useEffect(() => {
    if (stockSelected) return;
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setShowDropdown(false); return; }
    const timer = setTimeout(async () => {
      const results = await searchStocks(q);
      setSearchResults(results);
      setShowDropdown(results.length > 0);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, stockSelected]);

  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    if (!t) { setFetchedPrice(undefined); return; }
    if (livePrices[t] !== undefined) { setFetchedPrice(livePrices[t]); return; }
    const timer = setTimeout(async () => {
      setFetchingPrice(true);
      try {
        const info = await fetchTickerInfo(t);
        if (info) {
          setFetchedPrice(info.price);
          if (info.currency) setNativeCurrency(info.currency === 'GBp' ? 'GBP' : info.currency);
        }
      } finally {
        setFetchingPrice(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [ticker, livePrices]);

  function selectStock(stock: import('../lib/firebasePrices').StockResult) {
    setName(stock.name);
    setTicker(stock.symbol);
    setSearchQuery(`${stock.symbol} – ${stock.name}`);
    if (stock.currency) setNativeCurrency(stock.currency === 'GBp' ? 'GBP' : stock.currency);
    setShowDropdown(false);
    setStockSelected(true);
  }

  const livePrice = fetchedPrice;
  const effectivePrice = livePrice ?? (currentPrice ? Number(currentPrice) : null);
  const calcValue = units && effectivePrice != null ? Number(units) * effectivePrice : null;

  function handleSubmit() {
    const mv = calcValue ?? (manualValue ? Number(manualValue) : 0);
    if (!name.trim() || isNaN(mv) || mv < 0) return;
    onSave({
      name: name.trim(),
      ticker: ticker.trim() || undefined,
      units: units ? Number(units) : undefined,
      manualValue: mv,
      costBasis: avgCostPerShare && units ? Number(avgCostPerShare) * Number(units) : undefined,
      currency: nativeCurrency,
    });
  }

  const inputCls = "w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600 text-sm transition-colors";

  return (
    <Modal title={existing ? 'Edit Holding' : 'Add Holding'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 relative">
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Stock / Fund *</label>
            <input
              autoFocus
              className={inputCls}
              placeholder="Search by name or ticker (e.g. Apple, AAPL)"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setStockSelected(false); setName(e.target.value); setTicker(''); }}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && (
              <ul className="absolute z-50 left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                {searchResults.map(stock => (
                  <li
                    key={stock.symbol}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-700 cursor-pointer text-sm transition-colors"
                    onMouseDown={() => selectStock(stock)}
                  >
                    <span className="font-medium text-slate-100">{stock.name}</span>
                    <span className="text-slate-500 ml-3 font-mono text-xs">{stock.symbol}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Units held</label>
            <input type="number" min="0" className={inputCls} placeholder="0.0000" value={units} onChange={e => setUnits(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5 flex items-center gap-2">
              Price ({sym})
              <span className="text-xs text-slate-600 font-normal bg-slate-700 rounded-full px-2 py-0.5">{nativeCurrency}</span>
              {fetchingPrice && <span className="text-xs text-slate-500 animate-pulse">fetching…</span>}
              {!fetchingPrice && livePrice != null && (
                <span className="text-xs font-medium text-green-400 bg-green-900/20 border border-green-800/40 rounded-full px-2 py-0.5">live</span>
              )}
            </label>
            <input
              type="number" min="0"
              className={`${inputCls} disabled:opacity-50 disabled:text-slate-500`}
              placeholder="0.00"
              value={livePrice != null ? livePrice.toString() : currentPrice}
              disabled={livePrice != null}
              onChange={e => setCurrentPrice(e.target.value)}
            />
            {livePrice != null && <p className="text-xs text-green-400/70 mt-1">Live price from Firebase</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Current value ({sym}) *</label>
            {calcValue != null ? (
              <div className="w-full border border-slate-700 rounded-xl px-4 py-2.5 bg-slate-900/60 text-slate-300 text-sm tabular-nums">
                {sym}{calcValue.toFixed(2)}
                <span className="text-xs text-slate-600 ml-2">{livePrice != null ? 'units × live' : 'units × price'}</span>
              </div>
            ) : (
              <input
                type="number" min="0"
                className={inputCls}
                placeholder="Enter manually"
                value={manualValue}
                onChange={e => setManualValue(e.target.value)}
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Avg cost per share ({sym})</label>
            <input type="number" min="0" className={inputCls} placeholder="0.00" value={avgCostPerShare} onChange={e => setAvgCostPerShare(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-slate-700 rounded-xl py-2.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors text-sm">Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={handleSubmit}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 font-medium transition-colors disabled:opacity-40 text-sm"
          >
            {existing ? 'Save Changes' : 'Add Holding'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
