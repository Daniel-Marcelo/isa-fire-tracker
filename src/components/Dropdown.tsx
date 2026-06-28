import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option<T extends string> {
  value: T;
  label?: string;
}

interface Props<T extends string> {
  value: T;
  options: readonly T[] | Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
}

export default function Dropdown<T extends string>({ value, options, onChange, placeholder }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const normalised: Option<T>[] = options.map(o =>
    typeof o === 'string' ? { value: o as T } : o
  );

  const selected = normalised.find(o => o.value === value);
  const label = selected?.label ?? selected?.value ?? placeholder ?? '—';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between border border-slate-600 rounded-xl px-4 py-2.5 bg-slate-900 text-sm text-slate-100 hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
      >
        <span>{label}</span>
        <ChevronDown size={15} className={`text-slate-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
          {normalised.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-slate-700 transition-colors"
            >
              <span className={o.value === value ? 'font-medium text-indigo-400' : 'text-slate-300'}>
                {o.label ?? o.value}
              </span>
              {o.value === value && <Check size={14} className="text-indigo-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
