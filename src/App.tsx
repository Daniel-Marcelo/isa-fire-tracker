import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Flame, Download, Upload, Layers, LogOut, Cloud, CloudOff, RefreshCw, FolderOpen, Settings } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import type { AppData, UploadedFundHoldings } from './types';
import { defaultData, exportData, importData, migrateAppData } from './store';
import { supabase } from './lib/supabase';
import { loadFromSupabase, saveToSupabase, loadFundHoldings, saveFundHolding, deleteFundHolding, ConflictError } from './lib/db';
import { cacheAppData, readCachedAppData } from './lib/localCache';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
import { fetchQuotes, PRICE_WARN_AGE_MS, type Quote } from './lib/firebasePrices';
import { fetchFxRates, type FxRates } from './lib/fxRates';
import { withTodaySnapshots, type PriceAges } from './lib/snapshots';
import { applyLivePrices } from './lib/applyLivePrices';
import { toGbpView } from './lib/gbpView';
import { formatCurrency, formatCurrencyShort, SUPPORTED_CURRENCIES } from './utils';
import { CurrencyContext } from './contexts/CurrencyContext';
import PlanScreen from './components/PlanScreen';
import AdjustPlan from './components/AdjustPlan';
import AssumptionsForm from './components/AssumptionsForm';
import LookThrough from './components/LookThrough';
import FundManager from './components/FundManager';
import AuthScreen from './components/AuthScreen';
import Home from './components/Home';
import HoldingsList from './components/HoldingsList';
import AccountScreen from './components/AccountScreen';
import AccountForm from './components/AccountForm';
import HoldingForm from './components/HoldingForm';
import { uid } from './utils';
import AllowanceScreen from './components/AllowanceScreen';
import { isFormRoute } from './lib/formRoute';
import { AlertModal } from './components/Modal';
import './index.css';

type SyncState = 'idle' | 'syncing' | 'error';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<AppData>(defaultData);
  // The same portfolio valued in GBP regardless of the user's display currency.
  // The FIRE tab runs on this: its inputs (spending, contributions, state pension)
  // are inherently sterling, so feeding it display-converted pots would draw a
  // $-denominated pot down by £-denominated spending.
  const [gbpData, setGbpData] = useState<AppData>(defaultData);
  const [dataReady, setDataReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [degraded, setDegraded] = useState(false); // load failed: showing cache, saves blocked
  const [conflict, setConflict] = useState(false); // remote changed elsewhere: saves blocked
  const [importError, setImportError] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [livePricesUpdatedAt, setLivePricesUpdatedAt] = useState<Date | null>(null);
  const [livePricesLoading, setLivePricesLoading] = useState(false);
  // Newest feed timestamp across all held tickers — drives the staleness warning.
  const [newestPriceAsOf, setNewestPriceAsOf] = useState<number | null>(null);
  const [priceAges, setPriceAges] = useState<PriceAges>({});
  const [fxRates, setFxRates] = useState<FxRates>({ GBP: 1 });
  const [fundHoldings, setFundHoldings] = useState<UploadedFundHoldings[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseData = useRef<AppData>(defaultData);
  const loadedForUser = useRef<string | null>(null);
  // Optimistic-lock counter of the row we loaded; null means "no remote row yet".
  const versionRef = useRef<number | null>(null);
  // Single-flight guard: two saves with the same expectedVersion would make the
  // second one look like a conflict.
  const savingRef = useRef(false);
  // Latest payload awaiting the debounce, so the pagehide flush can find it.
  const pendingRef = useRef<AppData | null>(null);
  const livePricesRef = useRef<Record<string, number>>({});
  const priceCurrenciesRef = useRef<Record<string, string>>({});
  const priceAgesRef = useRef<PriceAges>({});
  const fxRatesRef = useRef<FxRates>({ GBP: 1 });
  // scheduleSave closes over stale state, so it reads these flags via refs.
  const degradedRef = useRef(false);
  const conflictRef = useRef(false);

  const setDegradedMode = useCallback((v: boolean) => {
    degradedRef.current = v;
    setDegraded(v);
  }, []);

  const setConflictMode = useCallback((v: boolean) => {
    conflictRef.current = v;
    setConflict(v);
  }, []);

  /** Current GBP valuation of `base`, using the latest prices/rates. See lib/gbpView. */
  const gbpViewNow = useCallback((base: AppData): AppData => toGbpView(
    base,
    livePricesRef.current,
    fxRatesRef.current,
    priceCurrenciesRef.current,
  ), []);

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
          setGbpData(defaultData);
          setDataReady(false);
        }
        return newUser;
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  /** The actual write. Extracted so the debounce and the pagehide flush share it. */
  const runSave = useCallback(async (next: AppData) => {
    if (!user) return;
    if (degradedRef.current || conflictRef.current) return; // never write over state we don't own
    if (savingRef.current) return;
    savingRef.current = true;
    setSyncState('syncing');
    try {
      const newVersion = await saveToSupabase(next, versionRef.current);
      versionRef.current = newVersion;
      cacheAppData(user.id, next, newVersion, false);
      setSyncState('idle');
    } catch (err) {
      if (err instanceof ConflictError) setConflictMode(true);
      setSyncState('error');
    } finally {
      savingRef.current = false;
    }
  }, [user, setConflictMode]);

  const loadData = useCallback((u: User) => {
    setDataReady(false);
    setSyncState('syncing');
    Promise.all([loadFromSupabase(), loadFundHoldings()])
      .then(([remote, funds]) => {
        const loaded = remote?.data ?? defaultData;
        const remoteVersion = remote?.version ?? null;
        versionRef.current = remoteVersion;
        setFundHoldings(funds);
        setDegradedMode(false);
        setConflictMode(false);

        // A dirty cache is an edit that never reached the server (tab killed
        // mid-debounce, offline). Replay it only when it is based on exactly the
        // version we just loaded — otherwise another device has moved on and
        // replaying would reintroduce the clobbering this version guard prevents.
        const cached = readCachedAppData(u.id);
        if (cached?.dirty && cached.version === remoteVersion) {
          const replayed = migrateAppData(cached.data);
          baseData.current = replayed;
          setData(replayed);
          setGbpData(replayed);
          void runSave(replayed);
        } else {
          if (cached?.dirty) console.warn('Discarding a stale unsaved local copy');
          baseData.current = loaded;
          setData(loaded);
          setGbpData(loaded);
          cacheAppData(u.id, loaded, remoteVersion, false);
          setSyncState('idle');
        }
        setDataReady(true);
      })
      .catch(() => {
        // Fall back to the last known-good local copy; run it through
        // migrateAppData in case it predates a schema change. Saves stay
        // blocked either way so a failed load can never overwrite the
        // remote data with an empty or stale portfolio.
        const cached = readCachedAppData(u.id);
        const fallback = cached ? migrateAppData(cached.data) : defaultData;
        versionRef.current = null;
        baseData.current = fallback;
        setData(fallback);
        setGbpData(fallback);
        setDegradedMode(true);
        setSyncState('error');
        setDataReady(true);
      });
  }, [setDegradedMode, setConflictMode, runSave]);

  useEffect(() => {
    if (!user) { loadedForUser.current = null; return; }
    if (loadedForUser.current === user.id) return;
    loadedForUser.current = user.id;
    loadData(user);
  }, [user, loadData]);

  const scheduleSave = useCallback((next: AppData) => {
    if (!user) return;
    if (degradedRef.current || conflictRef.current) return;
    pendingRef.current = next;
    // Written synchronously and marked dirty, so the edit survives the tab being
    // killed before the debounce fires. Cleared to dirty=false by runSave.
    cacheAppData(user.id, next, versionRef.current, true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(function attempt() {
      saveTimer.current = null;
      // A save is already in flight; re-arm rather than racing it with a version
      // that is about to be superseded.
      if (savingRef.current) { saveTimer.current = setTimeout(attempt, 300); return; }
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (payload) void runSave(payload);
    }, 1000);
  }, [user, runSave]);

  // Fire a pending save immediately when the page is hidden or unloading, instead
  // of losing it to the debounce. pagehide (not beforeunload) is the reliable
  // signal on mobile Safari, and sendBeacon can't carry PostgREST's auth headers.
  useEffect(() => {
    if (!user) return;
    const flush = () => {
      if (!saveTimer.current) return; // nothing pending — don't write on every tab switch
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (payload) void runSave(payload);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [user, runSave]);

  const refreshLivePrices = useCallback(async (base: AppData) => {
    const tickers = [...new Set(base.providers.flatMap(p => p.holdings.map(h => h.ticker).filter(Boolean) as string[]))];
    setLivePricesLoading(true);
    try {
      // One pass for price + currency + age; these used to be two identical walks
      // of the stock list.
      const [quotes, rates] = await Promise.all([
        tickers.length > 0 ? fetchQuotes(tickers) : Promise.resolve({} as Record<string, Quote>),
        fetchFxRates(),
      ]);
      const entries = Object.entries(quotes);
      const prices = entries.length > 0
        ? Object.fromEntries(entries.map(([t, q]) => [t, q.price]))
        : livePricesRef.current;
      const priceCcys = entries.length > 0
        ? Object.fromEntries(entries.flatMap(([t, q]) => (q.currency ? [[t, q.currency] as const] : [])))
        : priceCurrenciesRef.current;
      const ages: PriceAges = entries.length > 0
        ? Object.fromEntries(entries.map(([t, q]) => [t, q.asOf]))
        : priceAgesRef.current;

      livePricesRef.current = prices;
      fxRatesRef.current = rates;
      priceCurrenciesRef.current = priceCcys;
      priceAgesRef.current = ages;
      setLivePrices(prices);
      setPriceAges(ages);
      setFxRates(rates);
      const fresh = Object.values(ages).filter((a): a is number => a != null);
      setNewestPriceAsOf(fresh.length > 0 ? Math.max(...fresh) : null);

      const snapped = withTodaySnapshots(base, prices, rates, ages);
      if (snapped !== base) {
        baseData.current = snapped;
        scheduleSave(snapped);
      }
      setData(applyLivePrices(snapped, prices, rates, priceCcys));
      setGbpData(gbpViewNow(snapped));
      setLivePricesUpdatedAt(new Date());
    } catch (err) {
      console.warn('Live price refresh failed:', err);
    } finally {
      setLivePricesLoading(false);
    }
  }, [scheduleSave, gbpViewNow]);

  useEffect(() => {
    if (!dataReady) return;
    const REFRESH_MS = 5 * 60 * 1000;
    const lastRun = { at: 0 };
    const run = () => { lastRun.at = Date.now(); refreshLivePrices(baseData.current); };

    run();
    const interval = setInterval(() => {
      // A backgrounded PWA polling all night and all weekend costs real mobile data
      // and Firestore reads for numbers nobody is looking at.
      if (document.visibilityState !== 'visible') return;
      run();
    }, REFRESH_MS);

    // Returning to a tab that has been away longer than the interval should show
    // current prices, not whatever was on screen when it was last visible.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun.at > REFRESH_MS) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dataReady, refreshLivePrices]);

  const handleChange = useCallback((next: AppData) => {
    const snapped = withTodaySnapshots(next, livePricesRef.current, fxRatesRef.current, priceAgesRef.current);
    baseData.current = snapped;
    setData(applyLivePrices(snapped, livePricesRef.current, fxRatesRef.current, priceCurrenciesRef.current));
    setGbpData(gbpViewNow(snapped));
    scheduleSave(snapped);
  }, [scheduleSave, gbpViewNow]);

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
              <Shell
                user={user}
                data={data}
                gbpData={gbpData}
                baseData={baseData}
                handleChange={handleChange}
                livePrices={livePrices}
                priceAges={priceAges}
                fxRates={fxRates}
                fundHoldings={fundHoldings}
                isAdmin={isAdmin}
                syncState={syncState}
                degraded={degraded}
                conflict={conflict}
                newestPriceAsOf={newestPriceAsOf}
                livePricesLoading={livePricesLoading}
                livePricesUpdatedAt={livePricesUpdatedAt}
                refreshLivePrices={refreshLivePrices}
                loadData={loadData}
                currency={currency}
                currencyContextValue={currencyContextValue}
                handleCurrencyChange={handleCurrencyChange}
                handleImport={handleImport}
                handleUpdateFundHoldings={handleUpdateFundHoldings}
                handleDeleteFundHoldings={handleDeleteFundHoldings}
              />
            )
        }
      />
      {importError && (
        <AlertModal title="Import failed" message={importError} onClose={() => setImportError(null)} />
      )}
    </Routes>
  );
}

interface ShellProps {
  user: User;
  data: AppData;
  gbpData: AppData;
  baseData: { current: AppData };
  handleChange: (next: AppData) => void;
  livePrices: Record<string, number>;
  priceAges: PriceAges;
  fxRates: FxRates;
  fundHoldings: UploadedFundHoldings[];
  isAdmin: boolean;
  syncState: SyncState;
  degraded: boolean;
  conflict: boolean;
  newestPriceAsOf: number | null;
  livePricesLoading: boolean;
  livePricesUpdatedAt: Date | null;
  refreshLivePrices: (base: AppData) => Promise<void>;
  loadData: (user: User) => void;
  currency: string;
  currencyContextValue: React.ComponentProps<typeof CurrencyContext.Provider>['value'];
  handleCurrencyChange: (currency: string) => void;
  handleImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleUpdateFundHoldings: (uploaded: UploadedFundHoldings) => Promise<void>;
  handleDeleteFundHoldings: (fundTicker: string) => Promise<void>;
}

function Shell({
  user,
  data,
  gbpData,
  baseData,
  handleChange,
  livePrices,
  priceAges,
  fxRates,
  fundHoldings,
  isAdmin,
  syncState,
  degraded,
  conflict,
  newestPriceAsOf,
  livePricesLoading,
  livePricesUpdatedAt,
  refreshLivePrices,
  loadData,
  currency,
  currencyContextValue,
  handleCurrencyChange,
  handleImport,
  handleUpdateFundHoldings,
  handleDeleteFundHoldings,
}: ShellProps) {
  const formScreen = isFormRoute(useLocation().pathname);
  const pricesStale = newestPriceAsOf != null && Date.now() - newestPriceAsOf > PRICE_WARN_AGE_MS;

  return (
    <CurrencyContext.Provider value={currencyContextValue}>
      <div className="min-h-screen bg-[#02061a]">
        {!formScreen && (
          <header
            className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                  <Flame size={14} className="text-white" />
                </div>
                <span className="font-semibold text-slate-100 tracking-tight hidden sm:block">ISA & FIRE</span>
              </div>

              <nav className="hidden sm:flex bg-slate-800 rounded-xl p-1 gap-0.5">
                <TabLink to="/" icon={<BarChart3 size={14} />} label="Home" />
                <TabLink to="/holdings" icon={<Layers size={14} />} label="Holdings" />
                <TabLink to="/fire" icon={<Flame size={14} />} label="Plan" />
              </nav>

              <div className="flex items-center gap-2">
                {syncState !== 'idle' && (
                  <span className="flex items-center gap-1.5 text-xs">
                    {syncState === 'syncing' && <><Cloud size={13} className="text-indigo-400 animate-pulse" /><span className="text-slate-500 hidden sm:inline">Syncing</span></>}
                    {syncState === 'error' && <><CloudOff size={13} className="text-red-400" /><span className="text-red-400 hidden sm:inline">Sync error</span></>}
                  </span>
                )}
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
        )}

        {!formScreen && (
          <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/90 border-t border-slate-800 backdrop-blur-md flex" style={{paddingBottom: 'env(safe-area-inset-bottom)'}}>
            <BottomTabLink to="/" icon={<BarChart3 size={20} />} label="Home" />
            <BottomTabLink to="/holdings" icon={<Layers size={20} />} label="Holdings" />
            <BottomTabLink to="/fire" icon={<Flame size={20} />} label="Plan" />
          </nav>
        )}

        {degraded && (
          <div className="max-w-5xl mx-auto px-4 pt-4 relative z-[60]">
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

        {conflict && (
          <div className="max-w-5xl mx-auto px-4 pt-4 relative z-[60]">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-red-900/30 border border-red-800/40 rounded-xl px-4 py-2.5">
              <span className="text-sm text-red-300">
                This portfolio was changed on another device — your edits here aren't being saved.
              </span>
              <button
                onClick={() => loadData(user)}
                className="text-sm font-medium text-red-200 border border-red-700/60 rounded-lg px-3 py-1 hover:bg-red-900/40 transition-colors"
              >
                Reload
              </button>
            </div>
          </div>
        )}

        <main
          className={`max-w-5xl mx-auto px-4 py-6 ${formScreen ? 'pb-0' : 'pb-24 sm:pb-8'}`}
          style={formScreen ? undefined : {paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))'}}
        >
          <Routes>
            <Route
              path="/"
              element={
                <Home
                  data={data}
                  gbpData={gbpData}
                  rawData={baseData.current}
                  onChange={handleChange}
                  pricesUpdatedAt={livePricesUpdatedAt}
                  pricesStale={pricesStale}
                  fmt={currencyContextValue.fmt}
                  fmtShort={currencyContextValue.fmtShort}
                />
              }
            />
            <Route path="/holdings/new" element={
              <AccountForm data={data} rawData={baseData.current} onSave={(form) => {
                const provider = { id: uid(), ...form, owner: form.owner || undefined, holdings: [], snapshots: [] };
                handleChange({ ...baseData.current, providers: [...baseData.current.providers, provider] });
                return provider.id;
              }} />
            } />
            <Route path="/holdings/:providerId/edit" element={
              <AccountEditRoute rawData={baseData.current} onChange={handleChange} />
            } />
            <Route path="/holdings/:providerId/holdings/new" element={
              <HoldingRoute rawData={baseData.current} onChange={handleChange} livePrices={livePrices} priceAges={priceAges} />
            } />
            <Route path="/holdings/:providerId/holdings/:holdingId" element={
              <HoldingRoute rawData={baseData.current} onChange={handleChange} livePrices={livePrices} priceAges={priceAges} />
            } />
            <Route path="/holdings/:providerId" element={
              <AccountRoute data={data} rawData={baseData.current} onChange={handleChange} pricesStale={pricesStale} />
            } />
            <Route path="/holdings" element={<HoldingsList data={data} rawData={baseData.current} onChange={handleChange} livePrices={livePrices} priceAges={priceAges} fxRates={fxRates} pricesStale={pricesStale} />} />
            <Route
              path="/allowance"
              element={<AllowanceScreen rawData={baseData.current} onChange={handleChange} />}
            />
            <Route path="/lookthrough" element={<LookThrough data={data} fundHoldings={fundHoldings} pricesStale={pricesStale} />} />
            {isAdmin && <Route path="/funds" element={<FundManager fundHoldings={fundHoldings} onUpdateFundHoldings={handleUpdateFundHoldings} onDeleteFundHoldings={handleDeleteFundHoldings} />} />}
            <Route path="/fire/adjust" element={<AdjustPlan data={gbpData} rawData={baseData.current} onChange={handleChange} />} />
            <Route path="/fire/assumptions" element={<AssumptionsForm data={gbpData} rawData={baseData.current} onChange={handleChange} />} />
            <Route path="/fire" element={<PlanScreen data={gbpData} rawData={baseData.current} onChange={handleChange} pricesStale={pricesStale} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </CurrencyContext.Provider>
  );
}

function AccountRoute({ data, rawData, onChange, pricesStale }: { data: AppData; rawData: AppData; onChange: (data: AppData) => void; pricesStale: boolean }) {
  const { providerId } = useParams();
  const provider = data.providers.find(p => p.id === providerId);
  return provider ? <AccountScreen rawData={rawData} provider={provider} onChange={onChange} pricesStale={pricesStale} /> : <Navigate to="/holdings" replace />;
}

function AccountEditRoute({ rawData, onChange }: { rawData: AppData; onChange: (data: AppData) => void }) {
  const { providerId } = useParams();
  const navigate = useNavigate();
  const provider = rawData.providers.find(p => p.id === providerId);
  if (!provider) return <Navigate to="/holdings" replace />;
  return <AccountForm data={{ ...rawData }} rawData={rawData} provider={provider} onSave={(form, existing) => {
    if (!existing) return;
    onChange({ ...rawData, providers: rawData.providers.map(p => p.id === existing.id ? { ...p, ...form, owner: form.owner || undefined } : p) });
    navigate(`/holdings/${existing.id}`);
    return existing.id;
  }} />;
}

function HoldingRoute({ rawData, onChange, livePrices, priceAges }: {
  rawData: AppData; onChange: (data: AppData) => void;
  livePrices: Record<string, number>; priceAges: PriceAges;
}) {
  const { providerId, holdingId } = useParams();
  const navigate = useNavigate();
  const provider = rawData.providers.find(p => p.id === providerId);
  const holding = provider?.holdings.find(h => h.id === holdingId);
  if (!provider || (holdingId && !holding)) return <Navigate to="/holdings" replace />;
  return <HoldingForm provider={provider} providerId={providerId!} holding={holding} livePrices={livePrices} priceAges={priceAges}
    onSave={(form, existing) => {
      onChange({ ...rawData, providers: rawData.providers.map(p => p.id === provider.id ? { ...p, holdings: existing ? p.holdings.map(h => h.id === existing.id ? { ...h, ...form } : h) : [...p.holdings, { id: uid(), ...form }] } : p) });
      navigate(`/holdings/${provider.id}`);
    }}
    onDelete={(toDelete) => {
      onChange({ ...rawData, providers: rawData.providers.map(p => p.id === provider.id ? { ...p, holdings: p.holdings.filter(h => h.id !== toDelete.id) } : p) });
      navigate(`/holdings/${provider.id}`);
    }} />;
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
