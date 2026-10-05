import { Link, useNavigate } from 'react-router-dom';
import type { AppData } from '../types';
import FormScreen from './FormScreen';
import { NumberInput, useFireCalc } from './useFireCalc';

export default function AdjustPlan({ data, rawData, onChange }: { data: AppData; rawData: AppData; onChange: (data: AppData) => void }) {
  const navigate = useNavigate();
  const f = useFireCalc(data, rawData, onChange);
  const age = f.mode === 'earliest' ? f.solvedAge : f.chosenAge;
  return <FormScreen title="Adjust" commitLabel="Done" onCancel={() => navigate('/fire')} onCommit={() => navigate('/fire')}>
    <div className="space-y-5">
      <div className="flex justify-between border-b border-slate-800 pb-4"><span className="text-sm text-slate-400">FIRE age</span><span className="text-sm text-slate-200">{age == null ? '—' : age.toFixed(1)} · {f.confidence == null ? '—' : `${(f.confidence * 100).toFixed(0)}%`}</span></div>
      <NumberInput label="Spending per year" value={f.s.annualExpensesInRetirement} min={0} step={1000} prefix="£" onChange={v => f.update({ annualExpensesInRetirement: v })} />
      <NumberInput label="Monthly ISA contribution" value={f.s.monthlyContribution} min={0} step={50} prefix="£" onChange={v => f.update({ monthlyContribution: v })} />
      <NumberInput label="Monthly pension contribution" value={f.s.monthlyPensionContribution ?? 0} min={0} step={50} prefix="£" onChange={v => f.update({ monthlyPensionContribution: v })} />
      <NumberInput label="Retire at age" value={f.s.targetRetirementAge ?? 55} min={f.s.currentAge} max={f.planTo} onChange={v => f.update({ targetRetirementAge: v })} />
      <Link to="/fire/assumptions" className="block text-sm text-indigo-400">More assumptions</Link>
    </div>
  </FormScreen>;
}
