import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { AppData } from '../types';
import { currentTaxYear, getCurrentTaxYearContribution, setTaxYearContribution } from '../store';
import { formatCurrency, taxYearLabel, ISA_ANNUAL_ALLOWANCE } from '../utils';
import Modal from './Modal';

interface Props {
  rawData: AppData;
  onChange: (data: AppData) => void;
}

export default function AllowanceCard({ rawData, onChange }: Props) {
  const [showEdit, setShowEdit] = useState(false);
  const contributions = rawData.contributions ?? [];
  const taxYear = currentTaxYear();
  const used = getCurrentTaxYearContribution({ ...rawData, contributions });
  const pct = (used / ISA_ANNUAL_ALLOWANCE) * 100;
  const remaining = ISA_ANNUAL_ALLOWANCE - used;
  const barPct = Math.min(pct, 100);
  const barColor = pct > 100 ? 'bg-red-500' : pct >= 90 ? 'bg-amber-400' : 'bg-indigo-500';

  const now = new Date();
  const nextApril5Year = now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6)
    ? now.getFullYear() + 1
    : now.getFullYear();
  const nextApril5 = new Date(nextApril5Year, 3, 5);
  const daysLeft = Math.ceil((nextApril5.getTime() - now.getTime()) / 86_400_000);

  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-100">ISA allowance</h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-900/40 text-indigo-400">
            {taxYearLabel(taxYear)}
          </span>
        </div>
        <button
          onClick={() => setShowEdit(true)}
          className="p-1.5 text-slate-600 hover:text-indigo-400 transition-colors"
        >
          <Pencil size={13} />
        </button>
      </div>

      <p className="text-xl sm:text-2xl font-bold text-slate-50 mt-3 tabular-nums">
        {formatCurrency(used, 'GBP')} of {formatCurrency(ISA_ANNUAL_ALLOWANCE, 'GBP')} used
      </p>

      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mt-3">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <p className={`text-sm mt-2 tabular-nums ${remaining < 0 ? 'text-red-400' : 'text-slate-400'}`}>
        {remaining < 0
          ? `Over allowance by ${formatCurrency(-remaining, 'GBP')}`
          : `${formatCurrency(remaining, 'GBP')} remaining`}
      </p>

      <p className="text-xs text-slate-600 mt-1">{daysLeft} days left this tax year</p>

      {showEdit && (
        <AllowanceEditModal
          rawData={rawData}
          taxYear={taxYear}
          onSave={updated => { onChange(updated); setShowEdit(false); }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}

function AllowanceEditModal({ rawData, taxYear, onSave, onClose }: {
  rawData: AppData;
  taxYear: number;
  onSave: (data: AppData) => void;
  onClose: () => void;
}) {
  const contributions = rawData.contributions ?? [];
  const initialYears = Array.from(new Set([...contributions.map(c => c.taxYear), taxYear])).sort((a, b) => a - b);
  const [years, setYears] = useState<number[]>(initialYears);
  const [amounts, setAmounts] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (const y of initialYears) {
      const existing = contributions.find(c => c.taxYear === y);
      map[y] = existing ? String(existing.amount) : '';
    }
    return map;
  });

  function addPreviousYear() {
    const earliest = years[0];
    const newYear = earliest - 1;
    if (years.includes(newYear)) return;
    setYears([newYear, ...years]);
    setAmounts(prev => ({ ...prev, [newYear]: '' }));
  }

  function updateAmount(year: number, value: string) {
    setAmounts(prev => ({ ...prev, [year]: value }));
  }

  function handleSave() {
    let result = rawData;
    for (const y of years) {
      const raw = Number(amounts[y]);
      const amount = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      result = setTaxYearContribution(result, y, amount);
    }
    onSave(result);
  }

  return (
    <Modal title="Edit ISA contributions" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-3">
          {years.map(y => (
            <div key={y} className="flex items-center gap-3">
              <span className="w-16 text-sm text-slate-400 shrink-0">{taxYearLabel(y)}</span>
              <input
                type="number"
                min="0"
                className="flex-1 border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="0.00"
                value={amounts[y] ?? ''}
                onChange={e => updateAmount(y, e.target.value)}
              />
            </div>
          ))}
        </div>
        <button
          onClick={addPreviousYear}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
        >
          + Add previous year
        </button>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-slate-700 rounded-xl py-2.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors text-sm">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 font-medium transition-colors text-sm"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
