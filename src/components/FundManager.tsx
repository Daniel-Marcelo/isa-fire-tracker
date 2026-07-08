import { useState } from 'react';
import { Upload, Trash2, FileSpreadsheet, CalendarDays, Hash } from 'lucide-react';
import type { UploadedFundHoldings } from '../types';
import FundUploadModal from './FundUploadModal';

interface Props {
  fundHoldings: UploadedFundHoldings[];
  onUpdateFundHoldings: (holdings: UploadedFundHoldings) => void;
  onDeleteFundHoldings: (fundTicker: string) => void;
}

export default function FundManager({ fundHoldings, onUpdateFundHoldings, onDeleteFundHoldings }: Props) {
  const [showUpload, setShowUpload] = useState(false);
  const uploaded = fundHoldings;
  const existingTickers = uploaded.map(u => u.fundTicker);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Fund Holdings</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Upload a fund's holdings breakdown to power the Look-through analysis.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload fund
        </button>
      </div>

      {/* Empty state */}
      {uploaded.length === 0 && (
        <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-10 text-center">
          <FileSpreadsheet className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-base font-medium text-slate-400">No funds uploaded yet</p>
          <p className="text-sm text-slate-600 mt-1 max-w-sm mx-auto">
            Download a fund's holdings Excel file from Vanguard and upload it here. The Look-through tab will use it to show your effective stock exposure.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload your first fund
          </button>
        </div>
      )}

      {/* Fund cards */}
      {uploaded.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {uploaded.map(fund => (
            <FundCard
              key={fund.fundTicker}
              fund={fund}
              onReplace={() => setShowUpload(true)}
              onDelete={() => onDeleteFundHoldings(fund.fundTicker)}
            />
          ))}
        </div>
      )}

      {/* How-to hint */}
      {uploaded.length > 0 && (
        <p className="text-xs text-slate-600 px-1">
          To update a fund, upload a new file with the same ticker — it will replace the existing data.
        </p>
      )}

      {showUpload && (
        <FundUploadModal
          onClose={() => setShowUpload(false)}
          onSave={(h) => { onUpdateFundHoldings(h); setShowUpload(false); }}
          existingTickers={existingTickers}
        />
      )}
    </div>
  );
}

function FundCard({
  fund,
  onDelete,
}: {
  fund: UploadedFundHoldings;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const uploadedDate = new Date(fund.uploadedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  // Exclude the "Other" bucket from the count
  const holdingCount = fund.holdings.filter(h => h.ticker !== 'OTHER').length;

  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5 flex flex-col gap-4">
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div>
          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-indigo-900/40 text-indigo-400 text-xs font-mono font-semibold mb-1.5">
            {fund.fundTicker}
          </span>
          <p className="text-sm font-medium text-slate-100 leading-snug max-w-xs">
            {fund.fundName || fund.fundTicker}
          </p>
        </div>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {confirmDelete ? (
            <>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded"
              >
                Cancel
              </button>
              <button
                onClick={onDelete}
                className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
              title="Delete fund"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
        {fund.asAt && (
          <span className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-slate-600" />
            Data as at {fund.asAt}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5 text-slate-600" />
          {holdingCount} holdings
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          Uploaded {uploadedDate}
        </span>
      </div>

      {/* Top 5 mini-table */}
      <div className="rounded-lg border border-slate-700/30 overflow-hidden">
        <table className="w-full text-xs">
          <tbody className="divide-y divide-slate-700/30">
            {fund.holdings.filter(h => h.ticker !== 'OTHER').slice(0, 5).map(h => (
              <tr key={h.ticker} className="flex items-center px-3 py-1.5 gap-2">
                <td className="font-mono font-medium text-slate-400 w-16 flex-shrink-0 truncate">{h.ticker}</td>
                <td className="text-slate-600 flex-1 truncate">{h.name}</td>
                <td className="text-slate-500 flex-shrink-0 tabular-nums">{h.weight.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-1.5 bg-slate-900/60 text-xs text-slate-600 border-t border-slate-700/30">
          + {holdingCount - 5} more holdings
        </div>
      </div>
    </div>
  );
}
