import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Holding, Provider } from '../types';
import { fetchTickerInfo, searchStocks, PRICE_WARN_AGE_MS, type StockResult } from '../lib/firebasePrices';
import type { PriceAges } from '../lib/snapshots';
import { getCurrencySymbol, isCashType, SUPPORTED_CURRENCIES } from '../utils';
import FormScreen from './FormScreen';
import { ConfirmModal } from './Modal';

interface Props {
  provider: Provider;
  holding?: Holding;
  providerId: string;
  livePrices?: Record<string, number>;
  priceAges?: PriceAges;
  onSave: (form: Omit<Holding, 'id'>, existing?: Holding) => void;
  onDelete: (holding: Holding) => void;
}

export default function HoldingForm({ provider, holding, providerId, livePrices = {}, priceAges = {}, onSave, onDelete }: Props) {
  const navigate = useNavigate();
  const cashAccount = isCashType(provider.accountType);
  const [name, setName] = useState(holding?.name ?? '');
  const [ticker, setTicker] = useState(holding?.ticker ?? '');
  const [nativeCurrency, setNativeCurrency] = useState(holding?.currency ?? 'GBP');
  const [units, setUnits] = useState(holding?.units?.toString() ?? '');
  const [currentPrice, setCurrentPrice] = useState('');
  const [manualValue, setManualValue] = useState(holding?.manualValue?.toString() ?? '');
  const [avgCostPerShare, setAvgCostPerShare] = useState(holding?.costBasis != null && holding.units ? (holding.costBasis / holding.units).toFixed(4) : '');
  const [searchQuery, setSearchQuery] = useState(holding ? (holding.ticker ? `${holding.ticker} – ${holding.name}` : holding.name) : '');
  const [searchResults, setSearchResults] = useState<StockResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [stockSelected, setStockSelected] = useState(!!holding);
  const [fetchedPrice, setFetchedPrice] = useState<number | undefined>(holding?.ticker ? livePrices[holding.ticker] : undefined);
  const [fetchedAsOf, setFetchedAsOf] = useState<number | null>(holding?.ticker ? priceAges[holding.ticker] ?? null : null);
  const [priceIsFresh, setPriceIsFresh] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sym = getCurrencySymbol(nativeCurrency);
  const inputCls = 'w-full border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600 text-sm';

  useEffect(() => {
    if (stockSelected || cashAccount) return;
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setShowDropdown(false); return; }
    const timer = setTimeout(async () => {
      const results = await searchStocks(q);
      setSearchResults(results);
      setShowDropdown(results.length > 0);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, stockSelected, cashAccount]);

  const tickerKey = ticker.trim().toUpperCase();
  const livePriceForTicker = tickerKey ? livePrices[tickerKey] : undefined;
  const liveAsOfForTicker = tickerKey ? priceAges[tickerKey] ?? null : null;
  useEffect(() => {
    const applyAsOf = (asOf: number | null) => {
      setFetchedAsOf(asOf);
      setPriceIsFresh(asOf != null && Date.now() - asOf <= PRICE_WARN_AGE_MS);
    };
    if (!tickerKey || cashAccount) { setFetchedPrice(undefined); applyAsOf(null); return; }
    if (livePriceForTicker !== undefined) { setFetchedPrice(livePriceForTicker); applyAsOf(liveAsOfForTicker); return; }
    const timer = setTimeout(async () => {
      setFetchingPrice(true);
      try {
        const info = await fetchTickerInfo(tickerKey);
        if (info) {
          setFetchedPrice(info.price);
          applyAsOf(info.asOf ?? null);
          if (info.currency) setNativeCurrency(info.currency === 'GBp' ? 'GBP' : info.currency);
        }
      } finally { setFetchingPrice(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [tickerKey, livePriceForTicker, liveAsOfForTicker, cashAccount]);

  const livePrice = fetchedPrice;
  const effectivePrice = livePrice ?? (currentPrice ? Number(currentPrice) : null);
  const calcValue = units && effectivePrice != null ? Number(units) * effectivePrice : null;

  function selectStock(stock: StockResult) {
    setName(stock.name); setTicker(stock.symbol); setSearchQuery(`${stock.symbol} – ${stock.name}`);
    if (stock.currency) setNativeCurrency(stock.currency === 'GBp' ? 'GBP' : stock.currency);
    setShowDropdown(false); setStockSelected(true);
  }

  function commit() {
    if (cashAccount) {
      const balance = manualValue ? Number(manualValue) : 0;
      if (!name.trim() || isNaN(balance) || balance < 0) return;
      onSave({ name: name.trim(), manualValue: balance, currency: nativeCurrency }, holding);
      return;
    }
    const mv = calcValue ?? (manualValue ? Number(manualValue) : 0);
    if (!name.trim() || isNaN(mv) || mv < 0) return;
    onSave({ name: name.trim(), ticker: ticker.trim() || undefined, units: units ? Number(units) : undefined, manualValue: mv,
      costBasis: avgCostPerShare && units ? Number(avgCostPerShare) * Number(units) : undefined, currency: nativeCurrency }, holding);
  }

  return (
    <>
      <FormScreen title={holding ? 'Edit holding' : 'Add holding'} onCancel={() => navigate(`/holdings/${providerId}`)} onCommit={commit} commitLabel="Save">
        <div className="space-y-4">
          {cashAccount ? <>
            <Field label="Account name *"><input autoFocus className={inputCls} placeholder="e.g. Emergency fund, Marcus easy access…" value={name} onChange={e => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={`Balance (${sym}) *`}><input type="number" min="0" className={inputCls} placeholder="0.00" value={manualValue} onChange={e => setManualValue(e.target.value)} /></Field>
              <Field label="Currency"><select className={`${inputCls} cursor-pointer`} value={nativeCurrency} onChange={e => setNativeCurrency(e.target.value)}>{SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
            </div>
          </> : <>
            <div className="relative">
              <Field label="Stock / Fund *"><input autoFocus className={inputCls} placeholder="Search by name or ticker (e.g. Apple, AAPL)" value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setStockSelected(false); setName(e.target.value); setTicker(''); }} onFocus={() => { if (searchResults.length) setShowDropdown(true); }} onBlur={() => setTimeout(() => setShowDropdown(false), 150)} /></Field>
              {showDropdown && <ul className="absolute z-50 left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">{searchResults.map(stock => <li key={stock.symbol} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-700 cursor-pointer text-sm" onMouseDown={() => selectStock(stock)}><span className="font-medium text-slate-100">{stock.name}</span><span className="text-slate-500 ml-3 font-mono text-xs">{stock.symbol}</span></li>)}</ul>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Units held"><input type="number" min="0" className={inputCls} placeholder="0.0000" value={units} onChange={e => setUnits(e.target.value)} /></Field>
              <Field label={`Price (${sym})`}><input type="number" min="0" className={`${inputCls} disabled:opacity-50`} placeholder="0.00" value={livePrice != null ? livePrice.toString() : currentPrice} disabled={livePrice != null} onChange={e => setCurrentPrice(e.target.value)} />
                {livePrice != null && <p className={`text-xs mt-1 ${priceIsFresh ? 'text-green-400/70' : 'text-amber-400/70'}`}>{priceIsFresh ? 'Live price from Firebase' : `Last known price${fetchedAsOf != null ? ` from ${new Date(fetchedAsOf).toLocaleString()}` : ''}`}</p>}
                {fetchingPrice && <p className="text-xs text-slate-500 animate-pulse">fetching…</p>}</Field>
              <Field label={`Current value (${sym}) *`}>{calcValue != null ? <div className="border border-slate-700 rounded-xl px-4 py-2.5 bg-slate-900/60 text-slate-300 text-sm tabular-nums">{sym}{calcValue.toFixed(2)}</div> : <input type="number" min="0" className={inputCls} placeholder="Enter manually" value={manualValue} onChange={e => setManualValue(e.target.value)} />}</Field>
              <Field label={`Avg cost per share (${sym})`}><input type="number" min="0" className={inputCls} placeholder="0.00" value={avgCostPerShare} onChange={e => setAvgCostPerShare(e.target.value)} /></Field>
            </div>
          </>}
          {holding && <button type="button" onClick={() => setConfirmDelete(true)} className="w-full border border-red-800/60 text-red-400 rounded-xl py-2.5 text-sm font-medium hover:bg-red-900/20">Delete holding</button>}
        </div>
      </FormScreen>
      {confirmDelete && <ConfirmModal title="Delete holding" message={`Delete ${holding?.name}? This cannot be undone.`} confirmLabel="Delete" variant="danger"
        onConfirm={() => { if (holding) onDelete(holding); }} onClose={() => setConfirmDelete(false)} />}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-400">{label}<span className="block mt-1.5">{children}</span></label>;
}
