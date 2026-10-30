import { Link, useNavigate } from 'react-router-dom';
import type { AppData } from '../types';
import { formatCurrency } from '../utils';
import FormScreen from './FormScreen';
import { NumberInput } from './useFireCalc';
import { usePlan } from './usePlan';

export default function AdjustPlan({ data, rawData, onChange }: { data: AppData; rawData: AppData; onChange: (data: AppData) => void }) {
  const navigate = useNavigate();
  const f = usePlan(data, rawData, onChange);
  const outcome = f.mode === 'earliest'
    ? (f.retireAge == null ? '—' : String(f.retireAge))
    : (f.result.depletedAge == null ? `lasts to ${f.planTo}` : `runs out at ${f.result.depletedAge}`);
  return <FormScreen title="Adjust" commitLabel="Done" onCancel={() => navigate('/fire')} onCommit={() => navigate('/fire')}>
    <div className="space-y-5">
      <div className="flex justify-between border-b border-slate-800 pb-4"><span className="text-sm text-slate-400">{f.mode === 'earliest' ? 'FIRE age' : `Retire at ${f.chosenAge}`}</span><span className="text-sm text-slate-200 tabular-nums">{outcome} · needs {formatCurrency(f.fireNumber.target, 'GBP')}</span></div>
      <NumberInput label="Spending per year" value={f.s.annualExpensesInRetirement} min={0} step={1000} prefix="£" onChange={v => f.update({ annualExpensesInRetirement: v })} />
      <NumberInput label="Monthly ISA contribution" value={f.s.monthlyContribution} min={0} step={50} prefix="£" onChange={v => f.update({ monthlyContribution: v })} />
      <NumberInput label="Monthly pension contribution" value={f.s.monthlyPensionContribution ?? 0} min={0} step={50} prefix="£" onChange={v => f.update({ monthlyPensionContribution: v })} />
      <NumberInput label="Retire at age" value={f.s.targetRetirementAge ?? 55} min={f.s.currentAge} max={f.planTo - 1} hint="Used in Chosen age mode" onChange={v => f.update({ targetRetirementAge: v })} />
      <Link to="/fire/assumptions" className="block text-sm text-indigo-400">More assumptions</Link>
    </div>
  </FormScreen>;
}
