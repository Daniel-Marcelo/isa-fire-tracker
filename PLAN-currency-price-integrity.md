# PLAN: Currency & Price Data Integrity (rank 1 — do this first)

## Goal

Fix three silent data-corruption bugs in the price/currency pipeline:

1. **GBp (pence) prices are treated as pounds → 100× overstatement.** The Firestore
   price feed (`https://firestore.googleapis.com/v1/projects/nw-scrape/databases/(default)/documents/stocks`)
   returns some LSE tickers priced in pence with `currency: "GBp"` (verified live on
   2026-07-08: `HMWO GBp 3635.75`, `ISF GBp 1038.2`, `SWDA GBp 10711`; most others are
   `USD` or `GBP`). `fetchLivePrices()` in [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts)
   discards the currency and returns only numbers. Meanwhile the holding's own currency
   is stored as `'GBP'` (the `HoldingModal` maps `GBp → GBP` when a stock is selected),
   so `applyLivePrices()` in [src/App.tsx](src/App.tsx) converts the raw pence value as
   if it were pounds. A holding of 10 units of ISF shows as ~£10,382 instead of ~£103.82.

2. **JSON export corrupts data on round-trip.** `onExport={() => exportData(data)}` in
   [src/App.tsx](src/App.tsx) (inside the `UserMenu` usage, ~line 259) exports the
   **derived/display** state: `costBasis` already converted to the display currency, plus
   runtime `currentPrice`/`currentValue`. Re-importing that file treats the converted
   `costBasis` as a native-currency value again. If the display currency ≠ holding
   currency, cost basis is silently re-converted (double conversion). Export must use
   `baseData.current` (the raw, native-currency state) and strip derived fields.

3. **"Live" prices never refresh within a session.** `getAllStocks()` in
   [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts) caches `stockListCache`
   forever. The 5-minute refresh interval in `App.tsx` and the manual refresh button both
   re-read the same cached list, so prices only change on a full page reload.

## Files to touch

- [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts) — pence normalisation + cache TTL
- [src/store.ts](src/store.ts) — export/import hardening, shared migration helper
- [src/lib/db.ts](src/lib/db.ts) — reuse migration helper, export `stripDerived`
- [src/App.tsx](src/App.tsx) — export from `baseData.current`

Do NOT touch `src/lib/fxRates.ts` — its `normalise()` (GBp→÷100) is correct and stays as
the safety net inside `convertAmount`.

## Implementation order

### Step 1 — normalise pence at the price-feed boundary (`src/lib/firebasePrices.ts`)

Add one helper near the top:

```ts
// The feed prices LSE stocks in pence (currency "GBp" or "GBX"). Normalise to pounds
// so every price leaving this module is in a major-unit ISO currency.
function normalisePence(price: number | undefined, currency: string | undefined): { price: number | undefined; currency: string | undefined } {
  if (price != null && (currency === 'GBp' || currency === 'GBX')) {
    return { price: price / 100, currency: 'GBP' };
  }
  return { price, currency };
}
```

Apply it in **`getAllStocks()`** when mapping docs (so `searchStocks`, `fetchLivePrices`
and everything reading the cache is consistent):

```ts
const rawPrice = extractNumber(fields?.latestPrice) ?? undefined;
const rawCurrency = extractString(fields?.currency) ?? undefined;
const { price, currency } = normalisePence(rawPrice, rawCurrency);
return { symbol: ..., name: ..., price, currency };
```

Apply it in **`fetchTickerInfo()`** too (it fetches a single doc directly, bypassing the
cache): after extracting `price` and `currency`, run them through `normalisePence` and
return the normalised pair. Note: `HoldingModal` in `ISATracker.tsx` already maps
`info.currency === 'GBp' ? 'GBP' : info.currency`; after this change `info.currency`
will already be `'GBP'`, which is harmless — leave that line alone.

### Step 2 — give the stock-list cache a TTL (`src/lib/firebasePrices.ts`)

```ts
let stockListCache: StockResult[] | null = null;
let stockListFetchedAt = 0;
const STOCK_CACHE_TTL_MS = 4 * 60 * 1000; // refresh interval in App.tsx is 5 min

async function getAllStocks(): Promise<StockResult[]> {
  if (stockListCache && Date.now() - stockListFetchedAt < STOCK_CACHE_TTL_MS) return stockListCache;
  const res = await fetch(`${FIRESTORE_BASE}/stocks?pageSize=300`);
  if (!res.ok) return stockListCache ?? [];   // keep stale data on failure, don't blank out
  ...
  stockListCache = docs;
  stockListFetchedAt = Date.now();
  return docs;
}
```

Important: on fetch failure return the **stale cache** (`stockListCache ?? []`), never
wipe it — a transient network error must not zero-out portfolio values.

### Step 3 — shared migration helper + hardened import (`src/store.ts`, `src/lib/db.ts`)

In `src/store.ts`, add and export:

```ts
import type { AppData, Holding } from './types';

/** Drop runtime-derived fields so they are never persisted or exported. */
export function stripDerived(holding: Holding): Holding {
  const { currentPrice: _cp, currentValue: _cv, ...stored } = holding;
  return stored as Holding;
}

/** Normalise possibly-old AppData: legacy stored currentValue becomes manualValue; derived fields removed. */
export function migrateAppData(parsed: AppData): AppData {
  return {
    ...defaultData,
    ...parsed,
    fireSettings: { ...defaultData.fireSettings, ...parsed.fireSettings },
    userSettings: { ...defaultData.userSettings, ...parsed.userSettings },
    contributions: parsed.contributions ?? [],
    providers: (parsed.providers ?? []).map(p => ({
      ...p,
      snapshots: p.snapshots ?? [],
      holdings: (p.holdings ?? []).map(h => {
        const migrated = h.manualValue == null && h.currentValue != null
          ? { ...h, manualValue: h.currentValue }
          : h;
        return stripDerived(migrated);
      }),
    })),
  };
}
```

Then:
- `importData()` in `store.ts`: replace its inline spread-merge with `resolve(migrateAppData(parsed))`.
- `exportData()` in `store.ts`: before serialising, map providers/holdings through `stripDerived` so even a caller passing derived data can't leak runtime fields into the file.
- `loadFromSupabase()` in `src/lib/db.ts`: replace its inline migration block with `return migrateAppData(data.data as AppData);`. Delete the now-duplicated local `stripDerived` in `db.ts` and import it from `../store` instead (`saveToSupabase` keeps using it). There is no import cycle: `store.ts` imports nothing from `db.ts`.

Note `App.tsx` lines ~103–108 do the same defaultData spread-merge after
`loadFromSupabase()` — once `migrateAppData` runs inside `loadFromSupabase`, simplify
that block to `const loaded = remote ?? defaultData;`.

### Step 4 — export raw data (`src/App.tsx`)

Change `onExport={() => exportData(data)}` to `onExport={() => exportData(baseData.current)}`.

## Edge cases a weaker model would miss

- **`fxRates.normalise()` never fires for this bug.** You might think `convertAmount`
  already handles GBp — it does, but only when the *holding's* currency is the string
  `'GBP'` lowercase-p `'GBp'`. Holdings store `'GBP'` (the modal maps it), so the pence
  price sails through unconverted. That's why the fix must live in `firebasePrices.ts`.
- **`HoldingModal` bakes the pence price into `manualValue`.** `handleSubmit` saves
  `manualValue = calcValue = units × fetchedPrice`. Before this fix, users who saved an
  LSE holding stored a 100× `manualValue`. After the fix, `currentValue` self-heals on
  the next price refresh (it's recomputed from `units × price`), but the stored
  `manualValue` stays wrong and is used as fallback whenever the ticker has no live
  price. Do **not** write an automatic ÷100 migration (you can't distinguish a wrong
  value from a genuinely large manual one). Instead mention in the commit message that
  affected holdings self-correct on save/edit.
- **Old export files are not fully repairable.** The migration fixes derived-field
  leakage, but a `costBasis` that was already converted at export time is
  indistinguishable from a native one. Don't attempt to fix it; the migration just stops
  it from getting worse.
- **`stockListCache` failure path**: `fetchLivePrices` filters `price > 0`; a ticker
  missing from the map keeps its previous value in `livePricesRef` only if you don't
  overwrite — actually `App.refreshLivePrices` replaces the whole map, so returning
  stale cache on HTTP failure (step 2) is what protects values.
- **`GBX`** is an alternative pence code used by some feeds — handle both spellings even
  though today's feed only shows `GBp`.
- **Destructure-unused lint**: the existing `stripDerived` in `db.ts` carries an
  `eslint-disable @typescript-eslint/no-unused-vars` comment. Use the `_cp`/`_cv` rename
  pattern shown above instead, or keep the disable comment — either way `npm run lint`
  must pass.

## Acceptance criteria

1. `npm run build` and `npm run lint` pass.
2. In the running app (`npm run dev`, sign in), add a holding with ticker **ISF**
   (iShares Core FTSE 100) and, say, 10 units: the fetched price in the modal shows
   ~£10.38 (not ~£1038), and the portfolio row values it at ~£103.82.
   Verify feed raw value first: `curl` the Firestore URL above and confirm ISF's
   `latestPrice` is ~1038 with currency `GBp`; the app must show 1/100 of that.
3. A USD holding (e.g. AAPL) is unchanged by this work: value = units × price converted
   USD→display currency exactly as before.
4. Export data with display currency set to **USD** while holding a GBP-currency
   holding with a cost basis. Open the JSON: `costBasis` equals the native GBP number
   you entered (not a USD-converted one), and no `currentPrice`/`currentValue` keys
   appear anywhere in the file.
5. Import that same file back: all values identical after import (no drift). Repeat
   export→import a second time: still identical (idempotent round-trip).
6. Leave the app open >5 minutes (or click the refresh button twice, >4 min apart) and
   confirm via devtools Network tab that a fresh `stocks?pageSize=300` request fires
   the second time.
