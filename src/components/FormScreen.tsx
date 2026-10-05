import { createContext, useContext, type ReactNode } from 'react';

export const FormNoticesContext = createContext<ReactNode>(null);

interface Props {
  title: string;
  onCancel: () => void;
  onCommit: () => void;
  commitLabel: 'Save' | 'Done';
  children: ReactNode;
}

export default function FormScreen({ title, onCancel, onCommit, commitLabel, children }: Props) {
  const notices = useContext(FormNoticesContext);
  return (
    <div
      className="fixed inset-0 z-50 bg-[#02061a] flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
        <button type="button" onClick={onCancel} className="text-sm text-slate-400">Cancel</button>
        <h1 className="text-sm font-semibold text-slate-100">{title}</h1>
        <button type="button" onClick={onCommit} className="text-sm font-medium text-indigo-400">{commitLabel}</button>
      </div>
      {notices && <div className="px-4 pt-4 shrink-0">{notices}</div>}
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  );
}
