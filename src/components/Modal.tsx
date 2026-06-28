import type { ReactNode } from 'react';
import { X, AlertTriangle, Info } from 'lucide-react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ title, onClose, children }: Props) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-slate-50">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  variant?: 'danger' | 'default';
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm, onClose, variant = 'default' }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-sm">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${variant === 'danger' ? 'bg-red-900/40' : 'bg-slate-700'}`}>
              <AlertTriangle size={18} className={variant === 'danger' ? 'text-red-400' : 'text-slate-400'} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-50">{title}</h2>
              <p className="text-sm text-slate-400 mt-1">{message}</p>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium text-white transition-colors ${variant === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AlertModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

export function AlertModal({ title, message, onClose }: AlertModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-sm">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center">
              <Info size={18} className="text-red-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-50">{title}</h2>
              <p className="text-sm text-slate-400 mt-1">{message}</p>
            </div>
          </div>
          <div className="mt-6">
            <button onClick={onClose} className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-xl py-2.5 text-sm font-medium transition-colors">
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
