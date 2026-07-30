# PLAN: Stop downloading 1.5 MB every 4 minutes to price 20 tickers (rank 4)

> **Do this after [PLAN-29-08-2026-stale-price-guard.md](PLAN-29-08-2026-stale-price-guard.md).**
> That plan introduces `fetchQuotes`, which this plan re-implements on a different endpoint.
> Doing them in the other order means writing the batching twice.

## Goal

[`getAllStocks`](src/lib/firebasePrices.ts:67) pages through the **entire** `stocks`
collection in order to price the handful of tickers the user actually holds. Measured
against the live project on 2026-07-29:

```
GET .../documents/stocks?pageSize=300   →   1,498,703 bytes, no nextPageToken
```

So the whole collection comes back in one ~1.5 MB response, and the app refetches it every
4 minutes ([`STOCK_CACHE_TTL_MS`](src/lib/firebasePrices.ts:45), sized to the 5-minute
refresh interval at [App.tsx:158](src/App.tsx:158)). The payload is dominated by a `meta`
map per document (52-week ranges, trading-period calendars, pre/post-market blocks) that
this app never reads.

That is roughly **22 MB per hour** with a tab open, on mobile data, to obtain ~20 numbers.
It also costs ~300 Firestore document reads every 4 minutes — about **108,000 reads/day**
per continuously-open tab, against a 50,000/day free-tier allowance.

And it happens whether or not anyone is looking: the `setInterval` at
[App.tsx:158](src/App.tsx:158) is not gated on `document.visibilityState`, so a backgrounded
PWA keeps polling all night and all weekend.

Three fixes, in increasing order of payoff:

1. **Field mask** — ask for the five fields actually used, not `meta`.
2. **`:batchGet`** — request only the documents held, not the collection.
3. **Visibility gating** — do not poll a hidden tab.

## Files to touch

- [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts) — batchGet + field masks
- [src/App.tsx](src/App.tsx) — visibility-gated refresh
- [src/lib/firebasePrices.test.ts](src/lib/firebasePrices.test.ts) — extend

## Implementation order

### Step 1 — field-mask the list endpoint (used by search)

`getAllStocks` still has one legitimate consumer:
[`searchStocks`](src/lib/firebasePrices.ts:89), which needs every symbol and name to filter
against. Keep it, but stop pulling `meta`. Firestore's REST list endpoint accepts repeated
`mask.fieldPaths` query parameters:

```ts
const FIELD_PATHS = ['symbol', 'name', 'latestPrice', 'currency', 'lastUpdated'];

const url = new URL(`${FIRESTORE_BASE}/stocks`);
url.searchParams.set('pageSize', '300');
for (const f of FIELD_PATHS) url.searchParams.append('mask.fieldPaths', f);
```

This alone should cut the list response by well over 90%. Verify with the acceptance
criteria below — do not assume.

### Step 2 — price by `:batchGet`, not by full scan

Add a batched fetch and make `fetchQuotes` use it. The endpoint is a POST to
`{FIRESTORE_BASE}:batchGet` with fully-qualified document paths:

```ts
const DOC_PREFIX = `projects/${PROJECT_ID}/databases/(default)/documents/stocks`;
const BATCH_LIMIT = 100; // Firestore caps documents per batchGet request

async function batchGetDocs(ids: string[]): Promise<Map<string, StockResult>> {
  const out = new Map<string, StockResult>();
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const res = await fetch(`${FIRESTORE_BASE}:batchGet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: chunk.map(id => `${DOC_PREFIX}/${id}`),
        mask: { fieldPaths: FIELD_PATHS },
      }),
    });
    if (!res.ok) continue;                    // fall through to the list-based fallback
    const rows = await res.json();
    for (const row of rows ?? []) {
      if (!row.found) continue;               // { missing: "<path>" } for absent ids
      const mapped = mapDoc(row.found);
      if (mapped.symbol) out.set(mapped.symbol.toUpperCase(), mapped);
    }
  }
  return out;
}
```

`fetchQuotes` then becomes: batchGet the requested tickers → for anything still unresolved,
fall back to `getAllStocks()` **once** (the case-insensitivity safety net described below) →
for anything still missing, the existing single-doc `fetchTickerInfo`.

Crucially, remove `getAllStocks()` from the *happy path*. After this change a routine
refresh issues one small POST, and the full list is fetched only when the user types in the
stock search box or a ticker genuinely cannot be resolved.

### Step 3 — visibility-gated refresh

In [App.tsx](src/App.tsx), replace the unconditional interval at
[App.tsx:155-160](src/App.tsx:155):

```ts
useEffect(() => {
  if (!dataReady) return;
  const REFRESH_MS = 5 * 60 * 1000;
  const lastRun = { at: 0 };
  const run = () => { lastRun.at = Date.now(); refreshLivePrices(baseData.current); };

  run();
  const interval = setInterval(() => {
    if (document.visibilityState !== 'visible') return;   // don't poll a hidden tab
    run();
  }, REFRESH_MS);

  // Coming back to a tab that has been away longer than the interval: refresh now
  // rather than showing prices from whenever it was last visible.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun.at > REFRESH_MS) run();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
}, [dataReady, refreshLivePrices]);
```

The manual refresh button ([App.tsx:244](src/App.tsx:244)) must keep working unconditionally
— it is the user explicitly asking.

### Step 4 — tests

Extend `firebasePrices.test.ts` (stub `global.fetch`; call `__resetStockCache()` in
`beforeEach` as the file already does):

1. `fetchQuotes(['AAPL','VUSA'])` issues a **POST to `:batchGet`** whose body lists both
   document paths, and returns both quotes — assert `fetch` was called once and that the
   list endpoint was **not** hit.
2. A `{ missing: … }` row for one id, with the list endpoint stubbed to contain that symbol,
   resolves via the list fallback.
3. A non-`ok` batchGet response falls back to the list path rather than returning `{}`.
4. Chunking: 150 tickers produce two POSTs.
5. `searchStocks` still works and its request URL carries the `mask.fieldPaths` params.

## Edge cases a weaker model will miss

- **Firestore document ids are case-sensitive; the lookup key is not.** The current code
  upper-cases for map lookups but passes the *original* case to the single-doc endpoint —
  the comment at [firebasePrices.ts:111](src/lib/firebasePrices.ts:111) exists because this
  already bit someone. `:batchGet` needs the exact doc id, so a holding stored as `vusa`
  will come back `missing` even though `VUSA` exists. That is precisely why the
  `getAllStocks` fallback must stay: it matches case-insensitively. Do not delete it as
  "dead code".
- **`:batchGet` returns a JSON *array*, not `{documents: […]}`** like the list endpoint, and
  each element is either `{found: {name, fields}}` or `{missing: "<path>"}`. `mapDoc` expects
  the inner document object — pass `row.found`, not `row`.
- **Do not send an empty `documents` array**; Firestore rejects it. The existing
  `if (tickers.length === 0) return {}` guard covers this — keep it.
- **`normalisePence` must keep running.** LSE prices arrive as `GBp`/`GBX` and are divided by
  100 in [`mapDoc`](src/lib/firebasePrices.ts:47). Since batchGet reuses `mapDoc`, this is
  free — but if you inline a different mapper, every UK holding silently becomes 100× too
  large.
- **Keep `lastUpdated` in `FIELD_PATHS`.** The staleness guard from the previous plan depends
  on it; a field mask that omits it makes every price look undateable and therefore stale,
  which silently stops all snapshotting.
- **`stockListCache` must not be blanked on failure.** The existing
  `if (mapped.length === 0) return stockListCache ?? []` guard at
  [firebasePrices.ts:83](src/lib/firebasePrices.ts:83) is deliberate. Preserve it.
- **`document.visibilityState` is unavailable in the Vitest (node) environment.** Do not
  reference it inside `src/lib/` — keep the gating in `App.tsx`, which has no unit tests.

## Acceptance criteria

1. `npm run build` clean; `npm test` passes.
2. **Measure it.** With the app open and idle, devtools → Network, filter `firestore`, and
   watch one refresh cycle. Before: a ~1.5 MB request. After: a POST of a few KB. Record both
   numbers in the commit message.
3. Searching for a stock in the Add Holding modal still returns results, and its request URL
   contains `mask.fieldPaths`.
4. Background the tab for 10 minutes: **zero** Firestore requests fire during that time.
   Bring it back to the foreground: one refresh fires immediately.
5. Prices, the live pill, and today's snapshot are all unchanged in normal operation —
   compare a provider total before and after the change.
6. A holding whose ticker is stored in the wrong case still resolves a price (exercise the
   list fallback deliberately).
