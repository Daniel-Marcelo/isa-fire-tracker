import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Flame, Download, Upload, Layers, LogOut, Cloud, CloudOff, RefreshCw, FolderOpen, Settings } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import type { AppData, UploadedFundHoldings } from './types';
import { defaultData, exportData, importData, migrateAppData } from './store';
import { supabase } from './lib/supabase';
import { loadFromSupabase, saveToSupabase, loadFundHoldings, saveFundHolding, deleteFundHolding } from './lib/db';
import { cacheAppData, readCachedAppData } from './lib/localCache';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
import { fetchLivePrices, fetchPriceCurrencies } from './lib/firebasePrices';
import { fetchFxRates, type FxRates } from './lib/fxRates';
import { withTodaySnapshots } from './lib/snapshots';
import { applyLivePrices } from './lib/applyLivePrices';
import { formatCurrency, formatCurrencyShort, SUPPORTED_CURRENCIES } from './utils';
import { CurrencyContext } from './contexts/CurrencyContext';
import ISATracker from './components/ISATracker';
import FIRECalculator from './components/FIRECalculator';
import LookThrough from './components/LookThrough';
import FundManager from './components/FundManager';
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
  const [degraded, setDegraded] = useState(false); // load failed: showing cache, saves blocked
  const [importError, setImportError] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [livePricesUpdatedAt, setLivePricesUpdatedAt] = useState<Date | null>(null);
  const [livePricesLoading, setLivePricesLoading] = useState(false);
  const [fxRates, setFxRates] = useState<FxRates>({ GBP: 1 });
  const [fundHoldings, setFundHoldings] = useState<UploadedFundHoldings[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseData = useRef<AppData>(defaultData);
  const loadedForUser = useRef<string | null>(null);
  const livePricesRef = useRef<Record<string, number>>({});
  const priceCurrenciesRef = useRef<Record<string, string>>({});
  const fxRatesRef = useRef<FxRates>({ GBP: 1 });
  // scheduleSave closes over stale state, so it reads the degraded flag via a ref.
  const degradedRef = useRef(false);

  const setDegradedMode = useCallback((v: boolean) => {
    degradedRef.current = v;
    setDegraded(v);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(prev => {
        if (prev?.id === newUser?.id) return prev;
        if (!newUser) {
          setData(defaultData);
          setDataReady(false);
        }
        return newUser;
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback((u: User) => {
    setDataReady(false);
    setSyncState('syncing');
    Promise.all([loadFromSupabase(), loadFundHoldings()])
      .then(([remote, funds]) => {
        const loaded = remote ?? defaultData;
        baseData.current = loaded;
        setData(loaded);
        setFundHoldings(funds);
        cacheAppData(u.id, loaded);
        setDegradedMode(false);
        setSyncState('idle');
        setDataReady(true);
      })
      .catch(() => {
        // Fall back to the last known-good local copy; run it through
        // migrateAppData in case it predates a schema change. Saves stay
        // blocked either way so a failed load can never overwrite the
        // remote data with an empty or stale portfolio.
        const cached = readCachedAppData(u.id);
        const fallback = cached ? migrateAppData(cached) : defaultData;
        baseData.current = fallback;
        setData(fallback);
        setDegradedMode(true);
        setSyncState('error');
        setDataReady(true);
      });
  }, [setDegradedMode]);

  useEffect(() => {
    if (!user) { loadedForUser.current = null; return; }
    if (loadedForUser.current === user.id) return;
    loadedForUser.current = user.id;
    loadData(user);
  }, [user, loadData]);

  const scheduleSave = useCallback((next: AppData) => {
    if (!user) return;
    if (degradedRef.current) return; // never save over remote state we couldn't load
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSyncState('syncing');
      saveToSupabase(next)
        .then(() => {
          cacheAppData(user.id, next);
          setSyncState('idle');
        })
        .catch(() => setSyncState('error'));
    }, 1000);
  }, [user]);

  const refreshLivePrices = useCallback(async (base: AppData) => {
    const tickers = [...new Set(base.providers.flatMap(p => p.holdings.map(h => h.ticker).filter(Boolean) as string[]))];
    setLivePricesLoading(true);
    try {
      const [prices, rates, priceCcys] = await Promise.all([
        tickers.length > 0 ? fetchLivePrices(tickers) : Promise.resolve(livePricesRef.current),
        fetchFxRates(),
        tickers.length > 0 ? fetchPriceCurrencies(tickers) : Promise.resolve(priceCurrenciesRef.current),
      ]);
      livePricesRef.current = prices;
      fxRatesRef.current = rates;
      priceCurrenciesRef.current = priceCcys;
      setLivePrices(prices);
      setFxRates(rates);
      const snapped = withTodaySnapshots(base, prices, rates);
      if (snapped !== base) {
        baseData.current = snapped;
        scheduleSave(snapped);
      }
      setData(applyLivePrices(snapped, prices, rates, priceCcys));
      setLivePricesUpdatedAt(new Date());
    } catch (err) {
      console.warn('Live price refresh failed:', err);
    } finally {
      setLivePricesLoading(false);
    }
  }, [scheduleSave]);

  useEffect(() => {
    if (!dataReady) return;
    refreshLivePrices(baseData.current);
    const interval = setInterval(() => refreshLivePrices(baseData.current), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dataReady, refreshLivePrices]);

  const handleChange = useCallback((next: AppData) => {
    const snapped = withTodaySnapshots(next, livePricesRef.current, fxRatesRef.current);
    baseData.current = snapped;
    setData(applyLivePrices(snapped, livePricesRef.current, fxRatesRef.current, priceCurrenciesRef.current));
    scheduleSave(snapped);
  }, [scheduleSave]);

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    importData(file).then(d => handleChange(d)).catch(err => setImportError(err.message));
    e.target.value = '';
  }

  const currency = data.userSettings?.currency ?? 'GBP';
  const currencyContextValue = useMemo(() => ({
    currency,
    fmt: (v: number) => formatCurrency(v, currency),
    fmtShort: (v: number) => formatCurrencyShort(v, currency),
  }), [currency]);

  async function handleUpdateFundHoldings(uploaded: UploadedFundHoldings) {
    await saveFundHolding(uploaded);
    setFundHoldings(prev => [...prev.filter(f => f.fundTicker !== uploaded.fundTicker), uploaded]);
  }

  async function handleDeleteFundHoldings(fundTicker: string) {
    await deleteFundHolding(fundTicker);
    setFundHoldings(prev => prev.filter(f => f.fundTicker !== fundTicker));
  }

  function handleCurrencyChange(newCurrency: string) {
    handleChange({ ...baseData.current, userSettings: { ...baseData.current.userSettings, currency: newCurrency } });
  }

  const isAdmin = !!ADMIN_EMAIL && user?.email === ADMIN_EMAIL;

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
              <CurrencyContext.Provider value={currencyContextValue}>
              <div className="min-h-screen bg-[#02061a]">
                <header className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md">
                  <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
                    {/* Logo */}
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                        <Flame size={14} className="text-white" />
                      </div>
                      <span className="font-semibold text-slate-100 tracking-tight hidden sm:block">ISA & FIRE</span>
                    </div>

                    {/* Desktop nav */}
                    <nav className="hidden sm:flex bg-slate-800 rounded-xl p-1 gap-0.5">
                      <TabLink to="/" icon={<BarChart3 size={14} />} label="Portfolio" />
                      <TabLink to="/lookthrough" icon={<Layers size={14} />} label="Look-through" />
                      <TabLink to="/fire" icon={<Flame size={14} />} label="FIRE" />
                    </nav>

                    <div className="flex items-center gap-2">
                      {/* Sync status */}
                      {syncState !== 'idle' && (
                        <span className="flex items-center gap-1.5 text-xs">
                          {syncState === 'syncing' && <><Cloud size={13} className="text-indigo-400 animate-pulse" /><span className="text-slate-500 hidden sm:inline">Syncing</span></>}
                          {syncState === 'error' && <><CloudOff size={13} className="text-red-400" /><span className="text-red-400 hidden sm:inline">Sync error</span></>}
                        </span>
                      )}

                      {/* Live prices */}
                      <button
                        onClick={() => refreshLivePrices(baseData.current)}
                        disabled={livePricesLoading}
                        title={livePricesUpdatedAt ? `Updated ${livePricesUpdatedAt.toLocaleTimeString()}` : 'Refresh live prices'}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 transition-colors disabled:opacity-40"
                      >
                        <RefreshCw size={13} className={livePricesLoading ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline tabular-nums">
                          {livePricesUpdatedAt ? livePricesUpdatedAt.toLocaleTimeString() : 'Prices'}
                        </span>
                      </button>

                      {/* User menu */}
                      <UserMenu
                        email={user.email ?? ''}
                        currency={currency}
                        currencies={SUPPORTED_CURRENCIES}
                        onCurrencyChange={handleCurrencyChange}
                        onExport={() => exportData(baseData.current)}
                        onImport={handleImport}
                        onSignOut={() => supabase.auth.signOut()}
                        isAdmin={isAdmin}
                      />
                    </div>
                  </div>
                </header>

                {/* Bottom nav — mobile only */}
                <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/90 border-t border-slate-800 backdrop-blur-md flex" style={{paddingBottom: 'env(safe-area-inset-bottom)'}}>
                  <BottomTabLink to="/" icon={<BarChart3 size={20} />} label="Portfolio" />
                  <BottomTabLink to="/lookthrough" icon={<Layers size={20} />} label="Look-through" />
                  <BottomTabLink to="/fire" icon={<Flame size={20} />} label="FIRE" />
                </nav>

                {degraded && (
                  <div className="max-w-5xl mx-auto px-4 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-900/30 border border-amber-800/40 rounded-xl px-4 py-2.5">
                      <span className="text-sm text-amber-300">
                        Couldn't reach the server — showing your last synced data (read-only).
                      </span>
                      <button
                        onClick={() => loadData(user)}
                        className="text-sm font-medium text-amber-200 border border-amber-700/60 rounded-lg px-3 py-1 hover:bg-amber-900/40 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}

                <main className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-8" style={{paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))'}}>
                  <Routes>
                    <Route path="/" element={<ISATracker data={data} rawData={baseData.current} onChange={handleChange} livePrices={livePrices} fxRates={fxRates} />} />
                    <Route path="/lookthrough" element={<LookThrough data={data} fundHoldings={fundHoldings} />} />
                    {isAdmin && <Route path="/funds" element={<FundManager fundHoldings={fundHoldings} onUpdateFundHoldings={handleUpdateFundHoldings} onDeleteFundHoldings={handleDeleteFundHoldings} />} />}
                    <Route path="/fire" element={<FIRECalculator data={data} rawData={baseData.current} onChange={handleChange} />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
              </CurrencyContext.Provider>
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
        isActive
          ? 'bg-slate-700 text-slate-50'
          : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
      }`}
    >
      {icon}
      {label}
    </NavLink>
  );
}

function BottomTabLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  return (
    <NavLink
      to={to}
      className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${
        isActive ? 'text-indigo-400' : 'text-slate-600'
      }`}
    >
      {icon}
      {label}
    </NavLink>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen bg-[#02061a] flex items-center justify-center">
      <div className="text-slate-600 text-sm animate-pulse">Loading…</div>
    </div>
  );
}

interface UserMenuProps {
  email: string;
  currency: string;
  currencies: readonly { readonly code: string; readonly label: string }[];
  onCurrencyChange: (c: string) => void;
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSignOut: () => void;
  isAdmin?: boolean;
}

function UserMenu({ email, currency, currencies, onCurrencyChange, onExport, onImport, onSignOut, isAdmin }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-sm border rounded-lg px-2.5 py-1.5 transition-colors ${
          open
            ? 'bg-slate-700 text-slate-200 border-slate-600'
            : 'text-slate-400 hover:text-slate-200 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
        }`}
      >
        <Settings size={14} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl z-50 overflow-hidden">
          {/* Email */}
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-xs text-slate-500">Signed in as</p>
            <p className="text-sm font-medium text-slate-200 truncate mt-0.5">{email}</p>
          </div>

          {/* Currency */}
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-400">Currency</span>
            <select
              value={currency}
              onChange={e => onCurrencyChange(e.target.value)}
              className="text-sm text-slate-200 border border-slate-600 rounded-lg px-2 py-1 bg-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {currencies.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="py-1">
            {isAdmin && (
              <NavLink
                to="/funds"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
              >
                <FolderOpen size={15} className="text-slate-500" />
                Fund Holdings
              </NavLink>
            )}
            <button
              onClick={() => { onExport(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <Download size={15} className="text-slate-500" />
              Export data
            </button>
            <label className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer">
              <Upload size={15} className="text-slate-500" />
              Import data
              <input type="file" accept=".json" className="hidden" onChange={e => { onImport(e); setOpen(false); }} />
            </label>
          </div>

          {/* Sign out */}
          <div className="border-t border-slate-700 py-1">
            <button
              onClick={() => { onSignOut(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-900/20 transition-colors"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
