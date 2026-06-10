import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Flame, Download, Upload, Layers, LogOut, Cloud, CloudOff } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import type { AppData } from './types';
import { defaultData, exportData, importData } from './store';
import { supabase } from './lib/supabase';
import { loadFromSupabase, saveToSupabase } from './lib/db';
import ISATracker from './components/ISATracker';
import FIRECalculator from './components/FIRECalculator';
import LookThrough from './components/LookThrough';
import AuthScreen from './components/AuthScreen';
import { AlertModal } from './components/Modal';
import './index.css';

type SyncState = 'idle' | 'syncing' | 'error';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<AppData>(defaultData);
  const [dataReady, setDataReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        setData(defaultData);
        setDataReady(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load from Supabase when user signs in
  useEffect(() => {
    if (!user) return;
    setDataReady(false);
    setSyncState('syncing');
    loadFromSupabase()
      .then(remote => {
        setData(remote ? {
          ...defaultData,
          ...remote,
          fireSettings: { ...defaultData.fireSettings, ...remote.fireSettings },
        } : defaultData);
        setSyncState('idle');
        setDataReady(true);
      })
      .catch(() => {
        setSyncState('error');
        setData(defaultData);
        setDataReady(true);
      });
  }, [user]);

  const scheduleSave = useCallback((next: AppData) => {
    if (!user) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSyncState('syncing');
      saveToSupabase(next)
        .then(() => setSyncState('idle'))
        .catch(() => setSyncState('error'));
    }, 1000);
  }, [user]);

  const handleChange = useCallback((next: AppData) => {
    setData(next);
    scheduleSave(next);
  }, [scheduleSave]);

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    importData(file).then(d => handleChange(d)).catch(err => setImportError(err.message));
    e.target.value = '';
  }

  if (!authReady) return <Spinner />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthScreen />} />
      <Route
        path="/*"
        element={
          !user
            ? <Navigate to="/login" replace />
            : !dataReady
            ? <Spinner />
            : (
              <div className="min-h-screen bg-gray-50">
                <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
                  <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame size={20} className="text-indigo-600" />
                      <span className="font-bold text-gray-900 text-lg">ISA & FIRE Tracker</span>
                    </div>

                    <nav className="flex bg-gray-100 rounded-xl p-1 gap-1">
                      <TabLink to="/" icon={<BarChart3 size={15} />} label="ISA Portfolio" />
                      <TabLink to="/lookthrough" icon={<Layers size={15} />} label="Look-through" />
                      <TabLink to="/fire" icon={<Flame size={15} />} label="FIRE Calculator" />
                    </nav>

                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        {syncState === 'syncing' && <><Cloud size={13} className="animate-pulse text-indigo-400" /> Syncing</>}
                        {syncState === 'error' && <><CloudOff size={13} className="text-red-400" /> Sync error</>}
                      </span>
                      <button
                        onClick={() => exportData(data)}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                      >
                        <Download size={14} /> Export
                      </button>
                      <label className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors cursor-pointer">
                        <Upload size={14} /> Import
                        <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                      </label>
                      <button
                        onClick={() => supabase.auth.signOut()}
                        title={`Signed in as ${user.email}`}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                      >
                        <LogOut size={14} />
                      </button>
                    </div>
                  </div>
                </header>

                <main className="max-w-5xl mx-auto px-4 py-6">
                  <Routes>
                    <Route path="/" element={<ISATracker data={data} onChange={handleChange} />} />
                    <Route path="/lookthrough" element={<LookThrough data={data} />} />
                    <Route path="/fire" element={<FIRECalculator data={data} onChange={handleChange} />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            )
        }
      />
      {importError && (
        <AlertModal title="Import failed" message={importError} onClose={() => setImportError(null)} />
      )}
    </Routes>
  );
}

function TabLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  return (
    <NavLink
      to={to}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        isActive ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      {label}
    </NavLink>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
    </div>
  );
}
