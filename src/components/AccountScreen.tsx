import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Upload } from 'lucide-react';
import type { AppData, Provider } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { ConfirmModal } from './Modal';
import CSVImportModal from './CSVImportModal';
import { applyCsvImport } from './importHoldings';

interface Props {
  rawData: AppData;
  provider: Provider;
  onChange: (data: AppData) => void;
}

export default function AccountScreen({ rawData, provider, onChange }: Props) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();
  const [showImport, setShowImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const value = provider.holdings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
  const cost = provider.holdings.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const gain = value - cost;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/holdings')} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200"><ArrowLeft size={16} /> Holdings</button>
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: provider.color }} /><div><h1 className="font-semibold text-slate-100">{provider.name}</h1><div className="flex gap-2 mt-1 text-xs"><span className="text-slate-400">{provider.owner}</span><span className="text-indigo-400">{provider.accountType}</span></div></div></div>
          <div className="text-right shrink-0"><div className="font-semibold text-slate-100 tabular-nums">{fmt(value)}</div>{cost > 0 && <div className={`text-xs mt-0.5 tabular-nums ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>{gain >= 0 ? '+' : ''}{fmt(gain)}</div>}</div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link to={`/holdings/${provider.id}/edit`} className="flex items-center gap-1.5 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-700"><Pencil size={14} /> Edit account</Link>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-700"><Upload size={14} /> Import CSV</button>
          <button onClick={() => setConfirmDelete(true)} className="border border-red-800/60 rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20">Delete account</button>
        </div>
      </div>
      <div className="space-y-2">
        {provider.holdings.map(h => {
          const hGain = h.costBasis != null ? (h.currentValue ?? 0) - h.costBasis : null;
          return <Link key={h.id} to={`/holdings/${provider.id}/holdings/${h.id}`} className="block bg-slate-800/70 rounded-xl border border-slate-700/50 p-4 hover:bg-slate-700/40">
            <div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="font-medium text-slate-100 truncate">{h.name}</div><div className="text-xs text-slate-500 mt-1">{h.ticker ?? 'Cash'} · {h.units != null ? `${h.units.toFixed(4)} units` : '—'}</div></div><div className="text-right shrink-0"><div className="font-medium text-slate-100 tabular-nums">{fmt(h.currentValue ?? h.manualValue ?? 0)}</div>{hGain != null && <div className={`text-xs mt-0.5 tabular-nums ${hGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>{hGain >= 0 ? '+' : ''}{fmt(hGain)}</div>}</div></div>
          </Link>;
        })}
      </div>
      <Link to={`/holdings/${provider.id}/holdings/new`} className="flex items-center justify-center gap-2 w-full border border-dashed border-slate-700 rounded-xl py-3 text-sm font-medium text-indigo-400 hover:bg-slate-800"><Plus size={15} /> Add holding</Link>
      {showImport && <CSVImportModal providers={[provider]} onClose={() => setShowImport(false)} onImport={(providerId, parsed, mergeMode) => onChange(applyCsvImport(rawData, providerId, parsed, mergeMode))} />}
      {confirmDelete && <ConfirmModal title="Delete provider" message="Delete this provider and all its holdings? This cannot be undone." confirmLabel="Delete" variant="danger" onConfirm={() => { onChange({ ...rawData, providers: rawData.providers.filter(p => p.id !== provider.id) }); navigate('/holdings'); }} onClose={() => setConfirmDelete(false)} />}
    </div>
  );
}
