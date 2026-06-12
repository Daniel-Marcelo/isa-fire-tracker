import { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import Modal from './Modal';
import type { Provider } from '../types';
import { BROKER_PARSERS, type ParsedHolding } from '../lib/csvParsers';
import { useCurrency } from '../contexts/CurrencyContext';

interface Props {
  providers: Provider[];
  onClose: () => void;
  onImport: (providerId: string, holdings: ParsedHolding[], mergeMode: 'replace' | 'merge') => void;
}

type Step = 'upload' | 'preview';

export default function CSVImportModal({ providers, onClose, onImport }: Props) {
  const { fmt } = useCurrency();
  const [brokerId, setBrokerId] = useState(BROKER_PARSERS[0].id);
  const [targetProviderId, setTargetProviderId] = useState(providers[0]?.id ?? '');
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedHolding[]>([]);
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
        if (result.length === 0) throw new Error('No holdings found — check you selected the right broker format.');
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Broker / Platform</label>
            <select
              value={brokerId}
              onChange={e => setBrokerId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {BROKER_PARSERS.map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Choose the platform this transaction history was exported from.
            </p>
          </div>

          {/* Target provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Add to Provider</label>
            {providers.length === 0 ? (
              <p className="text-sm text-amber-600">Create a provider first before importing.</p>
            ) : (
              <select
                value={targetProviderId}
                onChange={e => setTargetProviderId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            className="border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-600 font-medium">Drop CSV here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Transaction history export (.csv)</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 rounded-xl px-4 py-2.5 text-sm font-medium">
            <CheckCircle2 size={16} />
            {parsed.length} holdings parsed
          </div>

          {/* Merge mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Import mode</label>
            <div className="flex gap-2">
              {(['replace', 'merge'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMergeMode(m)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    mergeMode === m
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {m === 'replace' ? 'Replace all holdings' : 'Merge with existing'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {mergeMode === 'replace'
                ? 'All current holdings in this provider will be removed and replaced with the imported ones.'
                : 'Imported holdings will be added to existing ones. Matching tickers will have their units and cost basis summed.'}
            </p>
          </div>

          {/* Preview table */}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Ticker</th>
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-right px-4 py-2.5">Units</th>
                  <th className="text-right px-4 py-2.5">Cost</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map(h => (
                  <tr key={h.ticker} className="border-t border-gray-50">
                    <td className="px-4 py-2.5 font-mono font-medium text-gray-900">{h.ticker}</td>
                    <td className="px-4 py-2.5 text-gray-500 truncate max-w-[140px]">{h.name}</td>
                    <td className="px-4 py-2.5 text-right text-gray-800">{h.units.toFixed(6)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-800">{fmt(h.costBasis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('upload'); setParsed([]); }}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={!targetProviderId}
              className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              Import to {providers.find(p => p.id === targetProviderId)?.name ?? '…'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
