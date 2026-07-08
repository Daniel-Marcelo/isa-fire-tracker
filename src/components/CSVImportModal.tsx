import { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import Modal from './Modal';
import type { Provider } from '../types';
import { BROKER_PARSERS, type ParsedImport } from '../lib/csvParsers';
import { useCurrency } from '../contexts/CurrencyContext';

interface Props {
  providers: Provider[];
  onClose: () => void;
  onImport: (providerId: string, parsed: ParsedImport, mergeMode: 'replace' | 'merge') => void;
}

type Step = 'upload' | 'preview';

export default function CSVImportModal({ providers, onClose, onImport }: Props) {
  const { fmt, currency } = useCurrency();
  const [brokerId, setBrokerId] = useState(BROKER_PARSERS[0].id);
  const [targetProviderId, setTargetProviderId] = useState(providers[0]?.id ?? '');
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedImport>({ holdings: [], dividends: [] });
  const [error, setError] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState<'replace' | 'merge'>('replace');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      try {
        const parser = BROKER_PARSERS.find(b => b.id === brokerId);
        if (!parser) throw new Error('Unknown broker');
        const result = parser.parse(text, currency);
        if (result.holdings.length === 0 && result.dividends.length === 0) throw new Error('No holdings found — check you selected the right broker format.');
        setParsed(result);
        setStep('preview');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleConfirm() {
    if (!targetProviderId) return;
    onImport(targetProviderId, parsed, mergeMode);
    onClose();
  }

  return (
    <Modal title="Import from CSV" onClose={onClose}>
      {step === 'upload' && (
        <div className="space-y-5">
          {/* Broker selector */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Broker / Platform</label>
            <select
              value={brokerId}
              onChange={e => setBrokerId(e.target.value)}
              className="w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {BROKER_PARSERS.map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
            <p className="text-xs text-slate-600 mt-1">
              Choose the platform this transaction history was exported from.
            </p>
          </div>

          {/* Target provider */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Add to Provider</label>
            {providers.length === 0 ? (
              <p className="text-sm text-amber-400">Create a provider first before importing.</p>
            ) : (
              <select
                value={targetProviderId}
                onChange={e => setTargetProviderId(e.target.value)}
                className="w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed border-slate-700 rounded-2xl p-10 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-950/40 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={32} className="mx-auto text-slate-600 mb-3" />
            <p className="text-sm text-slate-400 font-medium">Drop CSV here or click to browse</p>
            <p className="text-xs text-slate-600 mt-1">Transaction history export (.csv)</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/40 text-red-400 rounded-xl p-3 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-green-400 bg-green-900/20 border border-green-800/40 rounded-xl px-4 py-2.5 text-sm font-medium">
            <CheckCircle2 size={16} />
            {parsed.holdings.length} holdings{parsed.dividends.length > 0 ? ` · ${parsed.dividends.length} dividend payments` : ''} parsed
          </div>

          {/* Merge mode */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Import mode</label>
            <div className="flex gap-2">
              {(['replace', 'merge'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMergeMode(m)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    mergeMode === m
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                >
                  {m === 'replace' ? 'Replace all holdings' : 'Merge with existing'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {mergeMode === 'replace'
                ? 'All current holdings in this provider will be removed and replaced with the imported ones. Dividend history is also replaced with what\'s in this file.'
                : 'Imported holdings will be added to existing ones. Matching tickers will have their units and cost basis summed. New dividend payments are added; ones already recorded are skipped.'}
            </p>
          </div>

          {/* Preview table */}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-700/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/60 text-slate-600 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Ticker</th>
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-right px-4 py-2.5">Units</th>
                  <th className="text-right px-4 py-2.5">Cost</th>
                </tr>
              </thead>
              <tbody>
                {parsed.holdings.map(h => (
                  <tr key={h.ticker} className="border-t border-slate-700/30">
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-100">{h.ticker}</td>
                    <td className="px-4 py-2.5 text-slate-500 truncate max-w-[140px]">{h.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{h.units.toFixed(6)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{fmt(h.costBasis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('upload'); setParsed({ holdings: [], dividends: [] }); }}
              className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={!targetProviderId}
              className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              Import to {providers.find(p => p.id === targetProviderId)?.name ?? '…'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
