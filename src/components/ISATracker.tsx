import { useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import type { AppData, Provider, Holding, AccountType } from '../types';
import { uid, formatCurrency, PROVIDER_COLORS } from '../utils';
import { getCurrentTaxYearContribution, currentTaxYear } from '../store';
import Modal, { ConfirmModal } from './Modal';
import Dropdown from './Dropdown';
import PerformanceChart from './PerformanceChart';

const ISA_ALLOWANCE = 20000;

interface Props {
  data: AppData;
  onChange: (data: AppData) => void;
}

export default function ISATracker({ data, onChange }: Props) {
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [showAddHolding, setShowAddHolding] = useState<string | null>(null);
  const [editHolding, setEditHolding] = useState<{ providerId: string; holding: Holding } | null>(null);
  const [filterOwner, setFilterOwner] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const totalValue = data.providers.reduce(
    (sum, p) => sum + p.holdings.reduce((s, h) => s + h.currentValue, 0),
    0
  );

  const totalCostBasis = data.providers.reduce(
    (sum, p) => sum + p.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0),
    0
  );

  const totalGain = totalValue - totalCostBasis;
  const totalGainPct = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0;

  const currentContrib = getCurrentTaxYearContribution(data);
  const allowanceUsedPct = Math.min((currentContrib / ISA_ALLOWANCE) * 100, 100);

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
    if (existing) {
      onChange({
        ...data,
        providers: data.providers.map(p =>
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
      onChange({ ...data, providers: [...data.providers, provider] });
    }
    setShowAddProvider(false);
    setEditProvider(null);
  }

  function deleteProvider(id: string) {
    setConfirmDeleteId(id);
  }

  function confirmDeleteProvider() {
    if (!confirmDeleteId) return;
    onChange({ ...data, providers: data.providers.filter(p => p.id !== confirmDeleteId) });
  }

  function saveHolding(providerId: string, form: Omit<Holding, 'id'>, existing?: Holding) {
    onChange({
      ...data,
      providers: data.providers.map(p => {
        if (p.id !== providerId) return p;
        const holdings = existing
          ? p.holdings.map(h => h.id === existing.id ? { ...h, ...form } : h)
          : [...p.holdings, { id: uid(), ...form }];
        // Add snapshot on save
        const totalVal = holdings.reduce((s, h) => s + h.currentValue, 0);
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

  function deleteHolding(providerId: string, holdingId: string) {
    onChange({
      ...data,
      providers: data.providers.map(p =>
        p.id === providerId
          ? { ...p, holdings: p.holdings.filter(h => h.id !== holdingId) }
          : p
      ),
    });
  }

  function updateContribution(amount: number) {
    const ty = currentTaxYear();
    const existing = data.contributions.find(c => c.taxYear === ty);
    const contributions = existing
      ? data.contributions.map(c => c.taxYear === ty ? { ...c, amount } : c)
      : [...data.contributions, { taxYear: ty, amount }];
    onChange({ ...data, contributions });
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Total Portfolio" value={formatCurrency(totalValue)} />
        <SummaryCard
          label="Total Gain/Loss"
          value={formatCurrency(totalGain)}
          sub={totalCostBasis > 0 ? `${totalGain >= 0 ? '+' : ''}${totalGainPct.toFixed(1)}%` : undefined}
          positive={totalGain >= 0}
          colored
        />
        <SummaryCard label="Providers" value={String(data.providers.length)} />
        <SummaryCard label="Holdings" value={String(data.providers.reduce((s, p) => s + p.holdings.length, 0))} />
      </div>

      {/* Portfolio income snapshot */}
      {totalValue > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-100 p-5 shadow-sm">
            <p className="text-sm font-medium text-emerald-700">{(data.fireSettings?.withdrawalRate ?? 4).toFixed(1)}% Rule — safe annual withdrawal</p>
            <p className="text-3xl font-bold text-emerald-800 mt-2">{formatCurrency(totalValue * (data.fireSettings?.withdrawalRate ?? 4) / 100)}</p>
            <p className="text-xs text-emerald-600 mt-1">Withdraw this each year indefinitely (Trinity Study)</p>
          </div>
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl border border-indigo-100 p-5 shadow-sm">
            <p className="text-sm font-medium text-indigo-700">8% return — estimated annual earnings</p>
            <p className="text-3xl font-bold text-indigo-800 mt-2">{formatCurrency(totalValue * 0.08)}</p>
            <p className="text-xs text-indigo-600 mt-1">At 8% growth rate · {formatCurrency(totalValue * 0.08 / 12)}/mo</p>
          </div>
        </div>
      )}

      {/* ISA Allowance */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-900">
              ISA Allowance {currentTaxYear()}/{String(currentTaxYear() + 1).slice(2)}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {formatCurrency(currentContrib)} of {formatCurrency(ISA_ALLOWANCE)} used
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Contributions:</span>
            <input
              type="number"
              className="w-28 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={currentContrib}
              min={0}
              max={ISA_ALLOWANCE}
              onChange={e => updateContribution(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${allowanceUsedPct >= 100 ? 'bg-red-500' : allowanceUsedPct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
            style={{ width: `${allowanceUsedPct}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-right">
          {formatCurrency(ISA_ALLOWANCE - currentContrib)} remaining
        </p>
      </div>

      {/* Performance chart */}
      {data.providers.some(p => p.snapshots.length > 1) && (
        <PerformanceChart providers={data.providers} />
      )}

      {/* Providers */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-lg">Providers</h3>
        <button
          onClick={() => setShowAddProvider(true)}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus size={16} /> Add Provider
        </button>
      </div>

      {/* Filters */}
      {data.providers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 font-medium">Owner</span>
            <div className="flex gap-1">
              {owners.map(o => (
                <button key={o} onClick={() => setFilterOwner(o)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterOwner === o ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 font-medium">Type</span>
            <div className="flex gap-1">
              {accountTypes.map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterType === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {data.providers.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No providers yet</p>
          <p className="text-sm mt-1">Add your first ISA provider to get started</p>
        </div>
      )}

      {visibleProviders.map(provider => {
        const providerTotal = provider.holdings.reduce((s, h) => s + h.currentValue, 0);
        const providerCost = provider.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
        const gain = providerTotal - providerCost;
        const gainPct = providerCost > 0 ? (gain / providerCost) * 100 : 0;
        const expanded = expandedProviders.has(provider.id);

        return (
          <div key={provider.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div
              className="flex items-center gap-3 p-5 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => toggleExpand(provider.id)}
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: provider.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{provider.name}</span>
                  {provider.owner && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{provider.owner}</span>
                  )}
                  {provider.accountType && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">{provider.accountType}</span>
                  )}
                </div>
                <span className="text-sm text-gray-500">{provider.holdings.length} holdings</span>
              </div>
              <div className="text-right mr-2">
                <div className="font-semibold text-gray-900">{formatCurrency(providerTotal)}</div>
                {providerCost > 0 && (
                  <div className={`text-xs flex items-center justify-end gap-1 ${gain >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {gain >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {gain >= 0 ? '+' : ''}{formatCurrency(gain)} ({gainPct.toFixed(1)}%)
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={e => { e.stopPropagation(); setEditProvider(provider); }}
                  className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); deleteProvider(provider.id); }}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
              </div>
            </div>

            {expanded && (
              <div className="border-t border-gray-100">
                <div className="p-4">
                  <div className="flex justify-end mb-3">
                    <button
                      onClick={() => setShowAddHolding(provider.id)}
                      className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm font-medium transition-colors"
                    >
                      <Plus size={14} /> Add Holding
                    </button>
                  </div>
                  {provider.holdings.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No holdings yet</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-xs uppercase tracking-wide">
                            <th className="text-left pb-2 font-medium">Name</th>
                            <th className="text-right pb-2 font-medium">Units</th>
                            <th className="text-right pb-2 font-medium">Price</th>
                            <th className="text-right pb-2 font-medium">Value</th>
                            <th className="text-right pb-2 font-medium">Cost</th>
                            <th className="text-right pb-2 font-medium">Gain</th>
                            <th className="pb-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {provider.holdings.map(h => {
                            const hGain = h.costBasis != null ? h.currentValue - h.costBasis : null;
                            const hGainPct = h.costBasis ? (hGain! / h.costBasis) * 100 : null;
                            return (
                              <tr key={h.id} className="group">
                                <td className="py-2 pr-4">
                                  <div className="font-medium text-gray-900">{h.name}</div>
                                  {h.ticker && <div className="text-xs text-gray-400">{h.ticker}</div>}
                                </td>
                                <td className="py-2 text-right text-gray-600">{h.units?.toFixed(4) ?? '—'}</td>
                                <td className="py-2 text-right text-gray-600">{h.currentPrice ? formatCurrency(h.currentPrice) : '—'}</td>
                                <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(h.currentValue)}</td>
                                <td className="py-2 text-right text-gray-500">{h.costBasis != null ? formatCurrency(h.costBasis) : '—'}</td>
                                <td className="py-2 text-right">
                                  {hGain != null ? (
                                    <span className={hGain >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                                      {hGain >= 0 ? '+' : ''}{formatCurrency(hGain)}
                                      {hGainPct != null && <span className="text-xs ml-1">({hGainPct.toFixed(1)}%)</span>}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="py-2 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => setEditHolding({ providerId: provider.id, holding: h })}
                                      className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                                    >
                                      <Pencil size={13} />
                                    </button>
                                    <button
                                      onClick={() => deleteHolding(provider.id, h.id)}
                                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Allocation pie-like breakdown */}
      {visibleProviders.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">Portfolio Allocation</h3>
          <div className="space-y-3">
            {visibleProviders.map(p => {
              const val = p.holdings.reduce((s, h) => s + h.currentValue, 0);
              const pct = totalValue > 0 ? (val / totalValue) * 100 : 0;
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: p.color }} />
                      {p.name}
                    </span>
                    <span className="text-gray-600">{formatCurrency(val)} <span className="text-gray-400">({pct.toFixed(1)}%)</span></span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: p.color }} />
                  </div>
                </div>
              );
            })}
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
        />
      )}
      {editHolding && (
        <HoldingModal
          existing={editHolding.holding}
          onSave={form => saveHolding(editHolding.providerId, form, editHolding.holding)}
          onClose={() => setEditHolding(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, positive, colored }: {
  label: string; value: string; sub?: string; positive?: boolean; colored?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colored ? (positive ? 'text-emerald-600' : 'text-red-500') : 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className={`text-sm mt-0.5 ${positive ? 'text-emerald-600' : 'text-red-500'}`}>{sub}</p>}
    </div>
  );
}

const ACCOUNT_TYPES: AccountType[] = ['ISA', 'SIPP', 'GIA', 'Workplace Pension', 'Other'];
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Platform name</label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Vanguard, Freetrade, HL…"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <Dropdown value={owner} options={OWNERS} onChange={v => setOwner(v as Owner)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account type</label>
            <Dropdown value={accountType} options={ACCOUNT_TYPES} onChange={setAccountType} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Colour</label>
          <div className="grid grid-cols-10 gap-2">
            {PROVIDER_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={() => onSave({ name: name.trim(), owner: owner.trim(), accountType, color }, existing)}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40"
          >
            {existing ? 'Save Changes' : 'Add Provider'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HoldingModal({ existing, onSave, onClose }: {
  existing?: Holding;
  onSave: (form: Omit<Holding, 'id'>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [ticker, setTicker] = useState(existing?.ticker ?? '');
  const [units, setUnits] = useState(existing?.units?.toString() ?? '');
  const [currentPrice, setCurrentPrice] = useState(existing?.currentPrice?.toString() ?? '');
  const [currentValue, setCurrentValue] = useState(existing?.currentValue?.toString() ?? '');
  const [costBasis, setCostBasis] = useState(existing?.costBasis?.toString() ?? '');

  // Auto-calculate current value from units * price
  const calcValue = units && currentPrice ? Number(units) * Number(currentPrice) : null;
  const displayValue = calcValue != null ? calcValue.toFixed(2) : currentValue;

  function handleSubmit() {
    const cv = calcValue ?? Number(currentValue);
    if (!name.trim() || isNaN(cv) || cv < 0) return;
    onSave({
      name: name.trim(),
      ticker: ticker.trim() || undefined,
      units: units ? Number(units) : undefined,
      currentPrice: currentPrice ? Number(currentPrice) : undefined,
      currentValue: cv,
      costBasis: costBasis ? Number(costBasis) : undefined,
    });
  }

  return (
    <Modal title={existing ? 'Edit Holding' : 'Add Holding'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input autoFocus className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. FTSE Global All Cap" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ticker</label>
            <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. AAPL" value={ticker} onChange={e => setTicker(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Units held</label>
            <input type="number" min="0" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="0.0000" value={units} onChange={e => setUnits(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current price (£)</label>
            <input type="number" min="0" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="0.00" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current value (£) *</label>
            <input
              type="number" min="0"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="Auto-calculated or enter manually"
              value={displayValue}
              disabled={calcValue != null}
              onChange={e => setCurrentValue(e.target.value)}
            />
            {calcValue != null && <p className="text-xs text-gray-400 mt-1">Auto-calculated from units × price</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cost basis (£)</label>
            <input type="number" min="0" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Total amount invested" value={costBasis} onChange={e => setCostBasis(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={handleSubmit}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40"
          >
            {existing ? 'Save Changes' : 'Add Holding'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
