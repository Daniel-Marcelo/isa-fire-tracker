import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AccountType, AppData, Provider } from '../types';
import { PROVIDER_COLORS } from '../utils';
import Dropdown from './Dropdown';
import FormScreen from './FormScreen';

const ACCOUNT_TYPES: AccountType[] = ['ISA', 'SIPP', 'GIA', 'Workplace Pension', 'Cash ISA', 'Savings'];
const OWNERS = ['Daniel', 'Camilla'] as const;

interface Props {
  data: AppData;
  rawData: AppData;
  provider?: Provider;
  onSave: (form: { name: string; owner: string; accountType: AccountType; color: string }, existing?: Provider) => string | void;
}

export default function AccountForm({ data, provider, onSave }: Props) {
  const navigate = useNavigate();
  const [name, setName] = useState(provider?.name ?? '');
  const [owner, setOwner] = useState(provider?.owner ?? OWNERS[0]);
  const [accountType, setAccountType] = useState<AccountType>(provider?.accountType ?? 'ISA');
  const [color, setColor] = useState(provider?.color ?? PROVIDER_COLORS.find(c => !data.providers.some(p => p.color === c)) ?? PROVIDER_COLORS[0]);

  function commit() {
    if (!name.trim()) return;
    const id = onSave({ name: name.trim(), owner: owner.trim(), accountType, color }, provider);
    navigate(`/holdings/${id ?? provider?.id ?? ''}`);
  }

  return (
    <FormScreen title={provider ? 'Edit account' : 'Add account'} onCancel={() => navigate(-1)} onCommit={commit} commitLabel="Save">
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">Platform name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Vanguard, Freetrade, HL…"
            className="w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Owner</label>
            <Dropdown value={owner} options={OWNERS} onChange={setOwner} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Account type</label>
            <Dropdown value={accountType} options={ACCOUNT_TYPES} onChange={setAccountType} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Colour</label>
          <div className="grid grid-cols-10 gap-2">
            {PROVIDER_COLORS.map(c => (
              <button type="button" key={c} onClick={() => setColor(c)} title={c}
                className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-slate-100 scale-110' : 'border-transparent hover:scale-105 hover:border-slate-500'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      </div>
    </FormScreen>
  );
}
