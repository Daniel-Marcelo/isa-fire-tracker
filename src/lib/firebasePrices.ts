const PROJECT_ID = 'nw-scrape';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function extractNumber(field: unknown): number | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as Record<string, unknown>;
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('integerValue' in f) return Number(f.integerValue);
  return null;
}

function extractString(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as Record<string, unknown>;
  if ('stringValue' in f) return String(f.stringValue);
  return null;
}

// The feed prices LSE stocks in pence (currency "GBp" or "GBX"). Normalise to pounds
// so every price leaving this module is in a major-unit ISO currency.
function normalisePence(price: number | undefined, currency: string | undefined): { price: number | undefined; currency: string | undefined } {
  if (price != null && (currency === 'GBp' || currency === 'GBX')) {
    return { price: price / 100, currency: 'GBP' };
  }
  return { price, currency };
}

export interface TickerInfo {
  price: number;
  name?: string;
  currency?: string;
}

export interface StockResult {
  symbol: string;
  name: string;
  price?: number;
  currency?: string;
}

// Cache the full stock list so we don't refetch on every call, but refresh periodically
// so "live" prices actually update within a session.
let stockListCache: StockResult[] | null = null;
let stockListFetchedAt = 0;
const STOCK_CACHE_TTL_MS = 4 * 60 * 1000; // refresh interval in App.tsx is 5 min

function mapDoc(doc: Record<string, unknown>): StockResult {
  const fields = doc.fields as Record<string, unknown> | undefined;
  const rawPrice = extractNumber(fields?.latestPrice) ?? undefined;
  const rawCurrency = extractString(fields?.currency) ?? undefined;
  const { price, currency } = normalisePence(rawPrice, rawCurrency);
  return {
    symbol: extractString(fields?.symbol) ?? '',
    name: extractString(fields?.name) ?? '',
    price,
    currency,
  };
}

// Test-only hook: the stock list cache is module state, so tests need a way to
// reset it between cases without relying on vi.resetModules() + dynamic import.
export function __resetStockCache(): void {
  stockListCache = null;
  stockListFetchedAt = 0;
}

async function getAllStocks(): Promise<StockResult[]> {
  if (stockListCache && Date.now() - stockListFetchedAt < STOCK_CACHE_TTL_MS) return stockListCache;
  const docs: StockResult[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${FIRESTORE_BASE}/stocks`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString());
    if (!res.ok) break; // keep whatever we've gathered so far
    const json = await res.json();
    for (const doc of json.documents ?? []) docs.push(mapDoc(doc));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  const mapped = docs.filter(s => s.symbol);
  if (mapped.length === 0) return stockListCache ?? []; // never blank out on total failure
  stockListCache = mapped;
  stockListFetchedAt = Date.now();
  return mapped;
}

export async function searchStocks(query: string): Promise<StockResult[]> {
  if (!query.trim()) return [];
  const q = query.trim().toLowerCase();
  const all = await getAllStocks();
  return all
    .filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    .slice(0, 8);
}

export async function fetchLivePrices(tickers: string[]): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  const all = await getAllStocks();
  const bySymbol = new Map(all.map(s => [s.symbol.toUpperCase(), s.price]));
  const results: Record<string, number> = {};
  const missing: string[] = [];
  for (const ticker of tickers) {
    const price = bySymbol.get(ticker.toUpperCase());
    if (price != null && price > 0) results[ticker] = price;
    else missing.push(ticker);
  }
  if (missing.length > 0) {
    // The cached list page(s) may still be missing a ticker (universe grew, or it's
    // simply not on the current page); fall back to the precise single-doc endpoint.
    // Pass the original-case ticker — the doc id is case-sensitive Firestore data,
    // not necessarily the upper-cased lookup key.
    const infos = await Promise.all(missing.map(t => fetchTickerInfo(t).catch(() => null)));
    missing.forEach((t, i) => {
      const p = infos[i]?.price;
      if (p != null && p > 0) results[t] = p;
    });
  }
  return results;
}

export async function fetchPriceCurrencies(tickers: string[]): Promise<Record<string, string>> {
  if (tickers.length === 0) return {};
  const all = await getAllStocks();
  const bySymbol = new Map(all.map(s => [s.symbol.toUpperCase(), s.currency]));
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const t of tickers) {
    const c = bySymbol.get(t.toUpperCase());
    if (c) out[t] = c;
    else missing.push(t);
  }
  if (missing.length > 0) {
    const infos = await Promise.all(missing.map(t => fetchTickerInfo(t).catch(() => null)));
    missing.forEach((t, i) => {
      const c = infos[i]?.currency;
      if (c) out[t] = c;
    });
  }
  return out;
}

export async function fetchTickerInfo(ticker: string): Promise<TickerInfo | null> {
  const res = await fetch(`${FIRESTORE_BASE}/stocks/${ticker}`);
  if (!res.ok) return null;
  const doc = await res.json();
  const rawPrice = extractNumber(doc?.fields?.latestPrice);
  if (rawPrice === null || rawPrice === 0) return null;
  const rawCurrency = extractString(doc?.fields?.currency) ?? undefined;
  const { price, currency } = normalisePence(rawPrice, rawCurrency);
  return {
    price: price as number,
    name: extractString(doc?.fields?.name) ?? undefined,
    currency,
  };
}
