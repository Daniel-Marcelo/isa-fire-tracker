import { useNavigate } from 'react-router-dom';
import type { AppData } from '../types';
import FormScreen from './FormScreen';
import { NumberInput, useFireCalc } from './useFireCalc';

export default function AssumptionsForm({ data, rawData, onChange }: { data: AppData; rawData: AppData; onChange: (data: AppData) => void }) {
  const navigate = useNavigate();
  const f = useFireCalc(data, rawData, onChange);
  return <FormScreen title="Assumptions" commitLabel="Done" onCancel={() => navigate('/fire/adjust')} onCommit={() => navigate('/fire/adjust')}>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <NumberInput label="Current age" value={f.s.currentAge} min={18} max={80} onChange={v => f.update({ currentAge: v })} />
      <NumberInput label="Equity return (%/yr)" value={f.s.expectedAnnualReturn} min={0} max={30} step={0.5} suffix="%" onChange={v => f.update({ expectedAnnualReturn: v })} />
      <NumberInput label="Cash return (%/yr)" value={f.s.cashAnnualReturn ?? 3} min={0} max={10} step={0.25} suffix="%" onChange={v => f.update({ cashAnnualReturn: v })} />
      <NumberInput label="Inflation rate (%/yr)" value={f.s.inflationRate} min={0} max={20} step={0.5} suffix="%" onChange={v => f.update({ inflationRate: v })} />
      <NumberInput label="Pension access age" value={f.s.pensionAccessAge ?? 57} min={55} max={70} onChange={v => f.update({ pensionAccessAge: v })} />
      <NumberInput label="Target confidence (%)" value={f.s.targetConfidence ?? 90} min={50} max={99} suffix="%" onChange={v => f.update({ targetConfidence: v })} />
      <NumberInput label="Plan to age" value={f.s.planToAge ?? 95} min={80} max={105} onChange={v => f.update({ planToAge: v })} />
      <NumberInput label="Equity volatility (%/yr)" value={f.s.returnVolatility ?? 15} min={0} max={50} suffix="%" onChange={v => f.update({ returnVolatility: v })} />
      <NumberInput label="Pension drawdown tax (%)" value={f.s.pensionTaxRate ?? 15} min={0} max={60} suffix="%" onChange={v => f.update({ pensionTaxRate: v })} />
      <NumberInput label="GIA CGT rate (%)" value={f.s.giaCgtRate ?? 10} min={0} max={40} suffix="%" onChange={v => f.update({ giaCgtRate: v })} />
      <NumberInput label="Safe withdrawal rate (%)" value={f.s.withdrawalRate ?? 3.5} min={2} max={6} step={0.1} suffix="%" onChange={v => f.update({ withdrawalRate: v })} />
    </div>
    <div className="mt-5 pt-4 border-t border-slate-700/50">
      <div className="flex items-center gap-3 mb-3"><button role="switch" aria-checked={f.statePensionOn} onClick={() => f.update({ statePensionEnabled: !f.statePensionOn })} className={`relative w-9 h-5 rounded-full ${f.statePensionOn ? 'bg-teal-600' : 'bg-slate-700'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-slate-100 ${f.statePensionOn ? 'left-[18px]' : 'left-0.5'}`} /></button><span className="text-sm text-slate-300">State pension</span></div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${f.statePensionOn ? '' : 'opacity-40 pointer-events-none'}`}><NumberInput label="Amount (£/yr, today's money)" value={f.s.statePensionAnnual ?? 12000} min={0} step={100} onChange={v => f.update({ statePensionAnnual: v })} /><NumberInput label="From age" value={f.s.statePensionAge ?? 67} min={60} max={75} onChange={v => f.update({ statePensionAge: v })} /></div>
    </div>
  </FormScreen>;
}
