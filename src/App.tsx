import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Flame, Download, Upload, Layers, LogOut, Cloud, CloudOff, RefreshCw, FolderOpen, Settings } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import type { AppData, UploadedFundHoldings } from './types';
import { defaultData, exportData, importData } from './store';
import { supabase } from './lib/supabase';
import { loadFromSupabase, saveToSupabase, loadFundHoldings, saveFundHolding, deleteFundHolding } from './lib/db';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
import { fetchLivePrices } from './lib/firebasePrices';
import { fetchFxRates, convertAmount, type FxRates } from './lib/fxRates';
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
  const fxRatesRef = useRef<FxRates>({ GBP: 1 });

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(prev => {
        // Only update if the user actually changed (prevents TOKEN_REFRESHED from reloading data)
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

  function applyLivePrices(base: AppData, prices: Record<string, number>, rates: FxRates): AppData {
    const userCurrency = base.userSettings?.currency ?? 'GBP';

    function conv(amount: number, from: string) {
      return convertAmount(amount, from, userCurrency, rates);
    }

    return {
      ...base,
      providers: base.providers.map(provider => ({
        ...provider,
        holdings: provider.holdings.map(holding => {
          const hCurrency = holding.currency ?? 'GBP';
          const livePrice = holding.ticker ? prices[holding.ticker] : undefined;

          if (livePrice !== undefined) {
            const currentPrice = conv(livePrice, hCurrency);
            const currentValue = holding.units != null
              ? holding.units * currentPrice
              : conv(holding.currentValue, hCurrency);
            const costBasis = holding.costBasis != null ? conv(holding.costBasis, hCurrency) : undefined;
            return { ...holding, currentPrice, currentValue, ...(costBasis != null ? { costBasis } : {}) };
          }

          // No live price — just apply FX to stored values
          if (hCurrency === userCurrency) return holding;
          const currentValue = conv(holding.currentValue, hCurrency);
          const costBasis = holding.costBasis != null ? conv(holding.costBasis, hCurrency) : undefined;
          return { ...holding, currentValue, ...(costBasis != null ? { costBasis } : {}) };
        }),
      })),
    };
  }

  // Load user data + shared fund holdings when user signs in (guard against Supabase token refresh re-triggering)
  useEffect(() => {
    if (!user) { loadedForUser.current = null; return; }
    if (loadedForUser.current === user.id) return;
    loadedForUser.current = user.id;
    setDataReady(false);
    setSyncState('syncing');
    Promise.all([loadFromSupabase(), loadFundHoldings()])
      .then(([remote, funds]) => {
        const loaded = remote ? {
          ...defaultData,
          ...remote,
          fireSettings: { ...defaultData.fireSettings, ...remote.fireSettings },
          userSettings: { ...defaultData.userSettings, ...remote.userSettings },
        } : defaultData;
        baseData.current = loaded;
        setData(loaded);
        setFundHoldings(funds);
        setSyncState('idle');
        setDataReady(true);
      })
      .catch(() => {
        setSyncState('error');
        setData(defaultData);
        setDataReady(true);
      });
  }, [user]);

  const refreshLivePrices = useCallback(async (base: AppData) => {
    const tickers = [
      ...new Set(
        base.providers.flatMap(p => p.holdings.map(h => h.ticker).filter(Boolean) as string[])
      ),
    ];
    setLivePricesLoading(true);
    try {
      const [prices, rates] = await Promise.all([
        tickers.length > 0 ? fetchLivePrices(tickers) : Promise.resolve(livePricesRef.current),
        fetchFxRates(),
      ]);
      livePricesRef.current = prices;
      fxRatesRef.current = rates;
      setLivePrices(prices);
      setFxRates(rates);
      setData(applyLivePrices(base, prices, rates));
      setLivePricesUpdatedAt(new Date());
    } finally {
      setLivePricesLoading(false);
    }
  }, []);

  // Fetch live prices once data is ready, then every 5 minutes
  useEffect(() => {
    if (!dataReady) return;
    refreshLivePrices(baseData.current);
    const interval = setInterval(() => refreshLivePrices(baseData.current), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dataReady, refreshLivePrices]);

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
    baseData.current = next;
    setData(applyLivePrices(next, livePricesRef.current, fxRatesRef.current));
    scheduleSave(next);
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
              <div className="min-h-screen bg-gray-50">
                <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
                  <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame size={20} className="text-indigo-600" />
                      <span className="font-bold text-gray-900 text-lg">ISA & FIRE Tracker</span>
                    </div>

                    {/* Desktop nav — hidden on mobile */}
                    <nav className="hidden sm:flex bg-gray-100 rounded-xl p-1 gap-1">
                      <TabLink to="/" icon={<BarChart3 size={15} />} label="ISA Portfolio" />
                      <TabLink to="/lookthrough" icon={<Layers size={15} />} label="Look-through" />
                      <TabLink to="/fire" icon={<Flame size={15} />} label="FIRE Calculator" />
                    </nav>

                    <div className="flex items-center gap-2">
                      {/* Sync status */}
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        {syncState === 'syncing' && <><Cloud size={13} className="animate-pulse text-indigo-400" /> Syncing</>}
                        {syncState === 'error' && <><CloudOff size={13} className="text-red-400" /> Sync error</>}
                      </span>

                      {/* Live prices */}
                      <button
                        onClick={() => refreshLivePrices(baseData.current)}
                        disabled={livePricesLoading}
                        title={livePricesUpdatedAt ? `Live prices updated ${livePricesUpdatedAt.toLocaleTimeString()}` : 'Fetch live prices'}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={livePricesLoading ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline">
                          {livePricesUpdatedAt ? livePricesUpdatedAt.toLocaleTimeString() : 'Live prices'}
                        </span>
                      </button>

                      {/* User menu */}
                      <UserMenu
                        email={user.email ?? ''}
                        currency={currency}
                        currencies={SUPPORTED_CURRENCIES}
                        onCurrencyChange={handleCurrencyChange}
                        onExport={() => exportData(data)}
                        onImport={handleImport}
                        onSignOut={() => supabase.auth.signOut()}
                        isAdmin={isAdmin}
                      />
                    </div>
                  </div>
                </header>

                {/* Bottom nav — mobile only */}
                <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 flex" style={{paddingBottom: 'env(safe-area-inset-bottom)'}}>
                  <BottomTabLink to="/" icon={<BarChart3 size={20} />} label="Portfolio" />
                  <BottomTabLink to="/lookthrough" icon={<Layers size={20} />} label="Look-through" />
                  <BottomTabLink to="/fire" icon={<Flame size={20} />} label="FIRE" />
                </nav>

                <main className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-6" style={{paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))'}}>

                  <Routes>
                    <Route path="/" element={<ISATracker data={data} onChange={handleChange} livePrices={livePrices} fxRates={fxRates} />} />
                    <Route path="/lookthrough" element={<LookThrough data={data} fundHoldings={fundHoldings} />} />
                    {isAdmin && <Route path="/funds" element={<FundManager fundHoldings={fundHoldings} onUpdateFundHoldings={handleUpdateFundHoldings} onDeleteFundHoldings={handleDeleteFundHoldings} />} />}
                    <Route path="/fire" element={<FIRECalculator data={data} onChange={handleChange} />} />
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
        isActive ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
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
        isActive ? 'text-indigo-600' : 'text-gray-400'
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
        className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 transition-colors ${
          open
            ? 'bg-gray-100 text-gray-900 border-gray-200'
            : 'text-gray-600 hover:text-gray-900 border-gray-200 hover:bg-gray-50'
        }`}
      >
        <Settings size={14} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-gray-100 shadow-lg z-50 overflow-hidden">
          {/* Email */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs text-gray-400">Signed in as</p>
            <p className="text-sm font-medium text-gray-800 truncate mt-0.5">{email}</p>
          </div>

          {/* Currency */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <span className="text-sm text-gray-600">Currency</span>
            <select
              value={currency}
              onChange={e => onCurrencyChange(e.target.value)}
              className="text-sm text-gray-700 border border-gray-200 rounded-lg px-2 py-1 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <FolderOpen size={15} className="text-gray-400" />
                Fund Holdings
              </NavLink>
            )}
            <button
              onClick={() => { onExport(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Download size={15} className="text-gray-400" />
              Export data
            </button>
            <label className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
              <Upload size={15} className="text-gray-400" />
              Import data
              <input type="file" accept=".json" className="hidden" onChange={e => { onImport(e); setOpen(false); }} />
            </label>
          </div>

          {/* Sign out */}
          <div className="border-t border-gray-100 py-1">
            <button
              onClick={() => { onSignOut(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
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
