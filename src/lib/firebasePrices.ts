const PROJECT_ID = 'nw-scrape';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const DOC_PREFIX = `projects/${PROJECT_ID}/databases/(default)/documents/stocks`;

// The only fields this app reads. Each doc also carries a large `meta` map
// (52-week ranges, trading-period calendars, pre/post-market blocks) that we never
// touch; masking it out is what takes the list response from ~1.5 MB to a fraction.
const FIELD_PATHS = ['symbol', 'name', 'latestPrice', 'currency', 'lastUpdated'];

// Firestore caps the documents per :batchGet request.
const BATCH_LIMIT = 100;

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

/** Firestore timestampValue (RFC 3339) → epoch ms, or null if absent/unparseable. */
function extractTimestamp(field: unknown): number | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as Record<string, unknown>;
  if (!('timestampValue' in f)) return null;
  const ms = Date.parse(String(f.timestampValue));
  // Never let NaN through: `now - NaN > threshold` is false, so a bad timestamp
  // would silently read as fresh.
  return Number.isNaN(ms) ? null : ms;
}

/** Older than this and the UI warns, but still shows the price. */
export const PRICE_WARN_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Older than this and the price must not be written into snapshot history.
 * Sized to survive a normal weekend: on a Sunday the newest legitimate LSE
 * price is ~48h old, and false alarms every weekend would train us to ignore it.
 */
export const PRICE_SNAPSHOT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

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
  /** Epoch ms the feed last refreshed this symbol; null when the feed omits it. */
  asOf?: number | null;
}

export interface StockResult {
  symbol: string;
  name: string;
  price?: number;
  currency?: string;
  asOf?: number | null;
}

/** A price with everything needed to decide whether to trust it. */
export interface Quote {
  price: number;
  currency?: string;
  asOf: number | null;
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
    asOf: extractTimestamp(fields?.lastUpdated),
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
    for (const f of FIELD_PATHS) url.searchParams.append('mask.fieldPaths', f);
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

/**
 * Fetch exactly the documents asked for, keyed by upper-cased symbol.
 * Firestore doc ids are case-sensitive, so a ticker stored in the wrong case comes
 * back `missing` here — the caller falls back to the case-insensitive list scan.
 */
async function batchGetDocs(ids: string[]): Promise<Map<string, StockResult>> {
  const out = new Map<string, StockResult>();
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    let res: Response;
    try {
      res = await fetch(`${FIRESTORE_BASE}:batchGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: chunk.map(id => `${DOC_PREFIX}/${id}`),
          mask: { fieldPaths: FIELD_PATHS },
        }),
      });
    } catch {
      continue; // network error — let the list fallback try
    }
    if (!res.ok) continue;
    const rows = await res.json();
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      // Each row is { found: {name, fields} } or { missing: "<path>" }.
      if (!row?.found) continue;
      const mapped = mapDoc(row.found);
      if (mapped.symbol) out.set(mapped.symbol.toUpperCase(), mapped);
    }
  }
  return out;
}

/**
 * Price + currency + age for each ticker. This is the primary entry point;
 * fetchLivePrices/fetchPriceCurrencies below are thin derivations of it.
 *
 * Resolution order, cheapest first:
 *   1. :batchGet — only the documents held (a few KB)
 *   2. the full list — case-insensitive safety net, and warms the search cache
 *   3. the single-doc endpoint — last resort per still-unresolved ticker
 *
 * Step 1 is what keeps a routine refresh off the ~1.5 MB full-collection scan
 * this used to do every four minutes.
 */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  if (tickers.length === 0) return {};

  const out: Record<string, Quote> = {};
  const take = (ticker: string, hit: StockResult | undefined): boolean => {
    if (hit?.price == null || hit.price <= 0) return false;
    out[ticker] = { price: hit.price, currency: hit.currency, asOf: hit.asOf ?? null };
    return true;
  };

  const batched = await batchGetDocs(tickers);
  const missing = tickers.filter(t => !take(t, batched.get(t.toUpperCase())));

  if (missing.length > 0) {
    // Case mismatch, or a symbol whose doc id differs from its `symbol` field.
    const all = await getAllStocks();
    const bySymbol = new Map(all.map(s => [s.symbol.toUpperCase(), s]));
    const stillMissing = missing.filter(t => !take(t, bySymbol.get(t.toUpperCase())));

    if (stillMissing.length > 0) {
      // Pass the original-case ticker — the doc id is case-sensitive Firestore
      // data, not necessarily the upper-cased lookup key.
      const infos = await Promise.all(stillMissing.map(t => fetchTickerInfo(t).catch(() => null)));
      stillMissing.forEach((t, i) => {
        const info = infos[i];
        if (info?.price != null && info.price > 0) {
          out[t] = { price: info.price, currency: info.currency, asOf: info.asOf ?? null };
        }
      });
    }
  }
  return out;
}

export async function fetchLivePrices(tickers: string[]): Promise<Record<string, number>> {
  const quotes = await fetchQuotes(tickers);
  return Object.fromEntries(Object.entries(quotes).map(([t, q]) => [t, q.price]));
}

export async function fetchPriceCurrencies(tickers: string[]): Promise<Record<string, string>> {
  const quotes = await fetchQuotes(tickers);
  return Object.fromEntries(
    Object.entries(quotes).flatMap(([t, q]) => (q.currency ? [[t, q.currency] as const] : [])),
  );
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
    asOf: extractTimestamp(doc?.fields?.lastUpdated),
  };
}
