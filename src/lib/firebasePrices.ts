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

// Cache the full stock list so we only fetch it once per session
let stockListCache: StockResult[] | null = null;

async function getAllStocks(): Promise<StockResult[]> {
  if (stockListCache) return stockListCache;
  const res = await fetch(`${FIRESTORE_BASE}/stocks?pageSize=300`);
  if (!res.ok) return [];
  const json = await res.json();
  const docs: StockResult[] = (json.documents ?? []).map((doc: Record<string, unknown>) => {
    const fields = doc.fields as Record<string, unknown> | undefined;
    return {
      symbol: extractString(fields?.symbol) ?? '',
      name: extractString(fields?.name) ?? '',
      price: extractNumber(fields?.latestPrice) ?? undefined,
      currency: extractString(fields?.currency) ?? undefined,
    };
  }).filter((s: StockResult) => s.symbol);
  stockListCache = docs;
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
  const results: Record<string, number> = {};
  await Promise.allSettled(
    tickers.map(async (ticker) => {
      const res = await fetch(`${FIRESTORE_BASE}/stocks/${ticker}`);
      if (!res.ok) return;
      const doc = await res.json();
      const price = extractNumber(doc?.fields?.latestPrice);
      if (price !== null && price > 0) results[ticker] = price;
    })
  );
  return results;
}

export async function fetchTickerInfo(ticker: string): Promise<TickerInfo | null> {
  const res = await fetch(`${FIRESTORE_BASE}/stocks/${ticker}`);
  if (!res.ok) return null;
  const doc = await res.json();
  const price = extractNumber(doc?.fields?.latestPrice);
  if (price === null || price === 0) return null;
  return {
    price,
    name: extractString(doc?.fields?.name) ?? undefined,
    currency: extractString(doc?.fields?.currency) ?? undefined,
  };
}
