import { useRef, useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { parseVanguardHoldingsXlsx, buildUploadedFundHoldings } from '../lib/fundHoldingsParser';
import type { UploadedFundHoldings } from '../types';

interface Props {
  onClose: () => void;
  onSave: (holdings: UploadedFundHoldings) => void;
  existingTickers: string[];
}

type Status = 'idle' | 'parsing' | 'preview' | 'error';

export default function FundUploadModal({ onClose, onSave, existingTickers }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseVanguardHoldingsXlsx>> | null>(null);
  const [ticker, setTicker] = useState('');
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError('Please upload an Excel (.xlsx) file from Vanguard.');
      setStatus('error');
      return;
    }
    setStatus('parsing');
    setError('');
    try {
      const result = await parseVanguardHoldingsXlsx(file);
      setPreview(result);
      setTicker(result.fundTicker);
      setStatus('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleSave() {
    if (!preview || !ticker.trim()) return;
    const data = buildUploadedFundHoldings(preview, ticker.trim().toUpperCase());
    onSave(data);
    onClose();
  }

  const isUpdate = ticker && existingTickers.includes(ticker.toUpperCase());

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-base font-semibold text-slate-50">Upload Fund Holdings</h2>
            <p className="text-xs text-slate-400 mt-0.5">Vanguard UCITS ETF holdings file (.xlsx)</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Drop zone */}
          {status !== 'preview' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragging ? 'border-indigo-500 bg-indigo-950/40' : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/40'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {status === 'parsing' ? (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <span className="text-sm">Parsing file…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-slate-600" />
                  <p className="text-sm font-medium text-slate-400">Drop file here or click to browse</p>
                  <p className="text-xs text-slate-600">
                    Download from Vanguard → ETF page → Holdings → Export to Excel
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="flex items-start gap-3 bg-red-900/20 border border-red-800/40 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Parse error</p>
                <p className="text-xs text-red-400 mt-0.5">{error}</p>
                <button
                  onClick={() => { setStatus('idle'); setError(''); }}
                  className="mt-2 text-xs text-red-400 underline"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Preview */}
          {status === 'preview' && preview && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-green-900/20 border border-green-800/40 rounded-xl p-4">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-green-400">{preview.fundName || 'Fund detected'}</p>
                  {preview.asAt && <p className="text-green-400 text-xs mt-0.5">As at {preview.asAt}</p>}
                  <p className="text-green-400 text-xs mt-0.5">
                    {preview.totalHoldings} holdings parsed
                  </p>
                </div>
              </div>

              {/* Ticker assignment */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">
                  Fund ticker <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="e.g. VFEG"
                  className="w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {isUpdate && (
                  <p className="text-xs text-amber-400 mt-1">
                    This will replace existing data for {ticker}.
                  </p>
                )}
                <p className="text-xs text-slate-600 mt-1">
                  Must match the ticker used on your holdings (e.g. VFEG, VWRL, VHVG).
                </p>
              </div>

              {/* Top 5 preview */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Top holdings preview</p>
                <div className="rounded-lg border border-slate-700/30 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900/60">
                      <tr className="text-slate-600">
                        <th className="text-left px-3 py-2">Ticker</th>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-right px-3 py-2">Weight</th>
                        <th className="text-left px-3 py-2">Sector</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {preview.holdings.slice(0, 5).map((h) => (
                        <tr key={h.ticker}>
                          <td className="px-3 py-2 font-mono font-medium text-slate-400">{h.ticker}</td>
                          <td className="px-3 py-2 text-slate-400 truncate max-w-36">{h.name}</td>
                          <td className="px-3 py-2 text-right text-slate-400">{h.weight.toFixed(2)}%</td>
                          <td className="px-3 py-2 text-slate-500">{h.sector}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={() => { setStatus('idle'); setPreview(null); setTicker(''); }}
                className="text-xs text-slate-600 hover:text-slate-400 underline"
              >
                Upload a different file
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700/60 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          {status === 'preview' && (
            <button
              onClick={handleSave}
              disabled={!ticker.trim()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isUpdate ? 'Update holdings' : 'Save holdings'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
