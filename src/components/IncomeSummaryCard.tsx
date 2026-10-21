interface Props {
  label: string;
  value: number;
  sub: string;
  accessibleValue: number;
  pensionValue: number;
  fmt: (value: number) => string;
  fmtShort: (value: number) => string;
}

export default function IncomeSummaryCard({ label, value, sub, accessibleValue, pensionValue, fmt, fmtShort }: Props) {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-5">
      <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-slate-50 mt-2 tabular-nums">
        <span className="sm:hidden">{fmtShort(value)}</span>
        <span className="hidden sm:inline">{fmt(value)}</span>
      </p>
      <p className="text-xs text-slate-500 mt-1">{sub}</p>
      <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 gap-2">
        <div><p className="text-xs text-slate-500">ISA / GIA / Cash</p><p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(accessibleValue)}</p></div>
        <div><p className="text-xs text-slate-500">Pension / SIPP</p><p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtShort(pensionValue)}</p></div>
      </div>
    </div>
  );
}
