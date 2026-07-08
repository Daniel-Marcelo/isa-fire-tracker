import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { AppData, AllocationTarget } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { aggregatePositions, planNewMoney } from '../lib/rebalance';

interface Props {
  data: AppData;     // display data — read values from here
  rawData: AppData;  // canonical data — write targets through here
  onChange: (data: AppData) => void;
}

export default function RebalanceCard({ data, rawData, onChange }: Props) {
  const { fmt, fmtShort } = useCurrency();
  const targets = data.targets ?? [];
  const [expanded, setExpanded] = useState(targets.length > 0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [contribution, setContribution] = useState('');

  // Full portfolio, ignoring the page's owner/type filters — they are view
  // state and must not change the math.
  const positions = aggregatePositions(data);
  const targetByKey = new Map(targets.map(t => [t.key, t]));
  const positionByKey = new Map(positions.map(p => [p.key, p]));

  // Union of held positions and orphan targets (targets whose holding was sold).
  const rowKeys = [
    ...positions.map(p => p.key),
    ...targets.filter(t => !positionByKey.has(t.key)).map(t => t.key),
  ];

  const targetedValue = targets.reduce((s, t) => s + (positionByKey.get(t.key)?.value ?? 0), 0);
  const totalValue = positions.reduce((s, p) => s + p.value, 0);
  const untargetedValue = totalValue - targetedValue;
  const pctSum = targets.reduce((s, t) => s + t.targetPct, 0);

  function saveTargets(next: AllocationTarget[]) {
    onChange({ ...rawData, targets: next });
  }

  function commitTarget(key: string, raw: string) {
    setDraft(d => {
      const { [key]: _, ...rest } = d;
      return rest;
    });
    const v = parseFloat(raw);
    const others = targets.filter(t => t.key !== key);
    if (!raw.trim() || isNaN(v) || v <= 0) {
      if (targetByKey.has(key)) saveTargets(others);
      return;
    }
    saveTargets([...others, { key, targetPct: v }]);
  }

  function removeTarget(key: string) {
    saveTargets(targets.filter(t => t.key !== key));
  }

  const contributionNum = parseFloat(contribution);
  const plan = !isNaN(contributionNum) && contributionNum > 0
    ? planNewMoney(positions, targets, contributionNum)
    : [];

  if (rowKeys.length === 0) return null;

  return (
    <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-700/20 transition-colors"
      >
        <div>
          <p className="font-semibold text-slate-100">Target allocation</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {targets.length === 0
              ? 'Set target percentages to track drift and plan new contributions'
              : `${targets.length} target${targets.length !== 1 ? 's' : ''}${untargetedValue > 0.005 ? ` · ${fmtShort(untargetedValue)} untargeted` : ''}`}
          </p>
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-700/50 p-5 space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-600 text-xs uppercase tracking-wider border-b border-slate-700/40">
                  <th className="text-left pb-2 font-medium">Position</th>
                  <th className="text-right pb-2 font-medium">Value</th>
                  <th className="text-right pb-2 font-medium">Current</th>
                  <th className="text-right pb-2 font-medium">Target</th>
                  <th className="text-right pb-2 font-medium">Drift</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {rowKeys.map(key => {
                  const pos = positionByKey.get(key);
                  const target = targetByKey.get(key);
                  const value = pos?.value ?? 0;
                  // Current % against the *targeted* slice of the portfolio, so
                  // untargeted positions (e.g. pensions) don't dilute the denominator.
                  const currentPct = target && targetedValue > 0 ? (value / targetedValue) * 100 : null;
                  const normTargetPct = target && pctSum > 0 ? (target.targetPct / pctSum) * 100 : null;
                  const drift = currentPct != null && normTargetPct != null ? currentPct - normTargetPct : null;
                  const driftCls = drift == null ? 'text-slate-600'
                    : Math.abs(drift) <= 1 ? 'text-green-400'
                    : Math.abs(drift) <= 5 ? 'text-amber-400'
                    : 'text-red-400';
                  return (
                    <tr key={key} className="hover:bg-slate-700/20 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="font-medium text-slate-100">{pos?.label ?? key}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {key}
                          {!pos && <span className="ml-2 text-amber-400 font-sans">not held</span>}
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-slate-300 tabular-nums">{fmt(value)}</td>
                      <td className="py-2.5 text-right text-slate-400 tabular-nums">
                        {currentPct != null ? `${currentPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          placeholder="—"
                          value={draft[key] ?? (target ? String(target.targetPct) : '')}
                          onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                          onBlur={e => commitTarget(key, e.target.value)}
                          className="w-16 border border-slate-600 bg-slate-900 text-slate-100 rounded-lg px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-700"
                        />
                        <span className="text-slate-500 ml-1 text-xs">%</span>
                      </td>
                      <td className={`py-2.5 text-right tabular-nums text-xs ${driftCls}`}>
                        {drift != null ? `${drift >= 0 ? '+' : ''}${drift.toFixed(1)}pp` : '—'}
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        {target && (
                          <button
                            onClick={() => removeTarget(key)}
                            title="Remove target"
                            className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {targets.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="tabular-nums">Targets sum to {pctSum.toFixed(1)}%</span>
              {Math.abs(pctSum - 100) > 0.01 && (
                <span className="text-amber-400">≠ 100% — treated as relative weights</span>
              )}
              {untargetedValue > 0.005 && (
                <span className="tabular-nums">{fmt(untargetedValue)} of the portfolio has no target and is ignored above</span>
              )}
            </div>
          )}

          {targets.length > 0 && (
            <div className="pt-4 border-t border-slate-700/50">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-slate-400">New money to invest</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  placeholder="0.00"
                  value={contribution}
                  onChange={e => setContribution(e.target.value)}
                  className="w-32 border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600"
                />
              </div>
              {plan.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {plan.map(row => (
                    <div key={row.key} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">
                        Buy <span className="font-mono text-xs text-slate-400">{row.key}</span>
                      </span>
                      <span className="font-medium text-indigo-400 tabular-nums">{fmt(row.buy)}</span>
                    </div>
                  ))}
                  <p className="text-xs text-slate-600 pt-1">
                    Buy-only split that moves you toward target without selling.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
