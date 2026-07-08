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

async function getAllStocks(): Promise<StockResult[]> {
  if (stockListCache && Date.now() - stockListFetchedAt < STOCK_CACHE_TTL_MS) return stockListCache;
  const res = await fetch(`${FIRESTORE_BASE}/stocks?pageSize=300`);
  if (!res.ok) return stockListCache ?? []; // keep stale data on failure, don't blank out
  const json = await res.json();
  const docs: StockResult[] = (json.documents ?? []).map((doc: Record<string, unknown>) => {
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
  }).filter((s: StockResult) => s.symbol);
  stockListCache = docs;
  stockListFetchedAt = Date.now();
  return docs;
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
  for (const ticker of tickers) {
    const price = bySymbol.get(ticker.toUpperCase());
    if (price != null && price > 0) results[ticker] = price;
  }
  return results;
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
