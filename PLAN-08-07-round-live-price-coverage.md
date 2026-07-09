# PLAN: Live-price coverage & freshness (rank 3)

## Goal

Every live value in the app flows through one un-paginated 300-document fetch. Any holding
whose ticker isn't in that page **never gets a live price**, silently. When that happens:

- the holding is valued at its stale `manualValue` (or, for CSV imports, its cost basis),
  understating/overstating the portfolio without any indication;
- the whole **provider is excluded from today's snapshot** — `providerGbpTotal` in
  [src/lib/snapshots.ts](src/lib/snapshots.ts) returns `null` if *any* ticker'd holding
  with units has no live price — so the performance history silently stops recording.

Root cause in [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts):

```ts
const res = await fetch(`${FIRESTORE_BASE}/stocks?pageSize=300`);
```

`getAllStocks()` fetches a single page of 300 docs, no `nextPageToken` follow-up. If the
`nw-scrape` universe exceeds 300 stocks (or a held ticker simply isn't in it), that ticker
is invisible to both `searchStocks` and `fetchLivePrices`. There *is* a precise
single-doc endpoint already used by `fetchTickerInfo` (`GET .../stocks/{ticker}`) — but
nothing falls back to it when a requested ticker is missing from the cached list.

Make live pricing complete: **paginate the list**, and **fall back to the per-ticker
endpoint** for any requested ticker still missing after the list lookup.

## Files to touch

- [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts) — pagination + per-ticker fallback
- **New/extend:** `src/lib/firebasePrices.test.ts` — cover pagination and fallback with a
  mocked `fetch`
- No component changes required — `fetchLivePrices` keeps its `Record<string, number>`
  shape, so `App.tsx`, `snapshots.ts`, `applyLivePrices.ts` are untouched.

> Sequencing note: if
> [PLAN-08-07-round-csv-import-currency.md](PLAN-08-07-round-csv-import-currency.md) has
> landed, it adds `fetchPriceCurrencies` to this same file. Apply the fallback there too
> (return currencies for fallback-fetched tickers). If not, ignore — they don't conflict.

## Implementation order

### Step 1 — paginate `getAllStocks`

Firestore REST returns `nextPageToken` when more docs exist. Loop until it's absent or a
safety cap (say 20 pages / 6,000 docs) is hit:

```ts
async function getAllStocks(): Promise<StockResult[]> {
  if (stockListCache && Date.now() - stockListFetchedAt < STOCK_CACHE_TTL_MS) return stockListCache;
  const docs: StockResult[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${FIRESTORE_BASE}/stocks`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString());
    if (!res.ok) break;              // keep whatever we've gathered so far
    const json = await res.json();
    for (const doc of json.documents ?? []) docs.push(mapDoc(doc));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  const mapped = docs.filter(s => s.symbol);
  if (mapped.length === 0) return stockListCache ?? [];  // never blank out on total failure
  stockListCache = mapped;
  stockListFetchedAt = Date.now();
  return mapped;
}
```

Refactor the existing per-doc mapping (symbol/name/price/currency + `normalisePence`) into
a `mapDoc(doc)` helper so both the loop and any future caller share it.

**Edge cases a weaker model will miss:**
- On a **mid-pagination** `!res.ok` (page 3 of 5 fails), keep the docs already collected
  rather than throwing away the whole fetch — but do **not** overwrite the cache with a
  partial list if it ended up smaller than before *and* empty; the `mapped.length === 0`
  guard covers the total-failure case. A partial-but-nonempty list is acceptable (better
  than nothing) and will be replaced on the next TTL refresh.
- Keep `STOCK_CACHE_TTL_MS` as-is (4 min); pagination happens at most once per TTL window,
  not per `fetchLivePrices` call.

### Step 2 — per-ticker fallback in `fetchLivePrices`

After the list lookup, any requested ticker with no price should try the single-doc
endpoint (which `fetchTickerInfo` already implements and normalises):

```ts
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
    const infos = await Promise.all(missing.map(t => fetchTickerInfo(t).catch(() => null)));
    missing.forEach((t, i) => {
      const p = infos[i]?.price;
      if (p != null && p > 0) results[t] = p;
    });
  }
  return results;
}
```

**Edge cases a weaker model will miss:**
- `fetchTickerInfo` hits `.../stocks/{ticker}` with the ticker **verbatim** (case-
  sensitive Firestore doc id). The list stores/upcases symbols; the doc id may be the raw
  symbol. Pass the original-case `ticker`, not the upper-cased key, to `fetchTickerInfo`.
- Wrap each fallback in `.catch(() => null)` (done above) so one 404 can't reject the whole
  `Promise.all` and blank out prices that the list *did* resolve.
- `fetchTickerInfo` already applies `normalisePence`, so fallback prices are in pounds for
  GBp stocks — consistent with the list path. Do not re-normalise.
- Do **not** cache negative results; a ticker missing today may appear after the next
  scrape. The 4-min list TTL naturally re-attempts.

### Step 3 — tests

Add `firebasePrices.test.ts` with `vi.stubGlobal('fetch', ...)` (Vitest):
- **Pagination:** mock two pages (`nextPageToken` on page 1, absent on page 2) and assert
  `searchStocks`/`fetchLivePrices` can resolve a symbol that only appears on page 2.
- **Fallback:** mock the list to exclude `TSLA`, mock `.../stocks/TSLA` to return a valid
  doc, and assert `fetchLivePrices(['TSLA'])` returns a `TSLA` price.
- **Resilience:** mock the list to succeed and the fallback doc to 404; assert the list
  prices are still returned and no throw escapes.

Reset the module-level cache between tests (the cache is module state — either
`vi.resetModules()` + dynamic import per test, or export a small `__resetStockCache()`
test hook guarded by a comment).

## Acceptance criteria

1. `npm test` passes, including the three new cases.
2. A holding whose ticker is absent from the first 300-doc page now shows a live price
   (verify by picking such a ticker, or by temporarily lowering `pageSize` to force
   multi-page in a manual check).
3. With a valid held ticker that the list omits, the holding's provider now records a
   daily snapshot (it stops being excluded by `providerGbpTotal`), so the Portfolio
   performance chart keeps advancing.
4. A single unknown/404 ticker does not suppress prices for the other holdings in the same
   refresh.
5. Total feed outage still degrades gracefully: `fetchLivePrices` returns `{}` (or last
   cache) and the app renders stale values without crashing — unchanged from today.
