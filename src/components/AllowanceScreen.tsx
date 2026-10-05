import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppData } from '../types';
import { currentTaxYear, getCurrentTaxYearContribution, setTaxYearContribution } from '../store';
import { formatCurrency, taxYearLabel, ISA_ANNUAL_ALLOWANCE } from '../utils';
import FormScreen from './FormScreen';

interface Props {
  rawData: AppData;
  onChange: (data: AppData) => void;
}

export function initialAllowanceEditor(
  contributions: { taxYear: number; amount: number }[],
  taxYear: number,
) {
  const years = Array.from(new Set([...contributions.map(c => c.taxYear), taxYear])).sort((a, b) => a - b);
  const amounts: Record<number, string> = {};
  for (const y of years) {
    const existing = contributions.find(c => c.taxYear === y);
    amounts[y] = existing ? String(existing.amount) : '';
  }
  return { years, amounts };
}

export default function AllowanceScreen({ rawData, onChange }: Props) {
  const navigate = useNavigate();
  const taxYear = currentTaxYear();
  const contributions = rawData.contributions ?? [];
  const initial = initialAllowanceEditor(contributions, taxYear);

  const [years, setYears] = useState<number[]>(initial.years);
  const [amounts, setAmounts] = useState<Record<number, string>>(initial.amounts);

  const usedRaw = Number(amounts[taxYear]);
  const used = Number.isFinite(usedRaw) ? Math.max(0, usedRaw) : getCurrentTaxYearContribution(rawData);
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
    onChange(result);
    navigate('/');
  }

  return (
    <FormScreen
      title="ISA allowance"
      commitLabel="Save"
      onCancel={() => navigate('/')}
      onCommit={handleSave}
    >
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-900/40 text-indigo-400">
              {taxYearLabel(taxYear)}
            </span>
          </div>

          <p className="text-xl sm:text-2xl font-bold text-slate-50 tabular-nums">
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
        </div>

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
            type="button"
            onClick={addPreviousYear}
            className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
          >
            + Add previous year
          </button>
        </div>
      </div>
    </FormScreen>
  );
}
