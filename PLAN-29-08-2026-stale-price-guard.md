# PLAN: Detect stale live prices and keep them out of snapshot history (rank 3)

## Goal

The app cannot tell a fresh price from a dead feed, and it writes the difference into
permanent history.

[`firebasePrices.ts`](src/lib/firebasePrices.ts) reads `latestPrice`, `currency`, `symbol`
and `name` from each Firestore doc and **ignores the `lastUpdated` timestamp that is already
there**. Confirmed shape of a live document today:

```json
{
  "lastUpdated": { "timestampValue": "2026-07-28T21:08:41.732Z" },
  "latestPrice": { "doubleValue": 340.08 },
  "currency":    { "stringValue": "USD" },
  "symbol":      { "stringValue": "AAPL" },
  "name":        { "stringValue": "Apple Inc." },
  "meta":        { "mapValue": { … large … } }
}
```

Consequences today:

- If the separate `nw-scrape` scraper stops, the app keeps rendering the last scraped price
  behind a **green "live" badge** ([ISATracker.tsx:940](src/components/ISATracker.tsx:940))
  forever. The user has no way to know.
- Worse, [`withTodaySnapshots`](src/lib/snapshots.ts:45) records that stale number as *today's
  portfolio value*, permanently, in the `snapshots` array that drives
  [PerformanceChart](src/components/PerformanceChart.tsx). A week of scraper downtime writes
  a week of flat, fictional history that cannot be distinguished from a real flat week.

Note the existing care in [`providerGbpTotal`](src/lib/snapshots.ts:26): it already refuses
to snapshot a provider when a price is *missing*. This plan applies the same rigour to
prices that are merely *old*.

## Files to touch

- [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts) — read `lastUpdated`; add a
  consolidated `fetchQuotes`
- [src/lib/snapshots.ts](src/lib/snapshots.ts) — refuse to snapshot on stale inputs
- [src/App.tsx](src/App.tsx) — hold quote ages, pass them down, warn in the header
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — stop calling a stale price "live"
- [src/lib/firebasePrices.test.ts](src/lib/firebasePrices.test.ts),
  [src/lib/snapshots.test.ts](src/lib/snapshots.test.ts) — extend

## Implementation order

### Step 1 — extract the timestamp, and consolidate the two identical passes

`firebasePrices.ts` currently walks the stock list **twice** —
[`fetchLivePrices`](src/lib/firebasePrices.ts:98) and
[`fetchPriceCurrencies`](src/lib/firebasePrices.ts:123) are the same function with a
different field plucked. Collapse them into one call that returns everything.

Add a timestamp extractor beside the existing `extractNumber` / `extractString`:

```ts
function extractTimestamp(field: unknown): number | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as Record<string, unknown>;
  if ('timestampValue' in f) {
    const ms = Date.parse(String(f.timestampValue));
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}
```

Extend `StockResult` and `mapDoc` with `asOf: number | null` (epoch ms, from `lastUpdated`),
then add the consolidated fetch:

```ts
export interface Quote {
  price: number;
  currency?: string;
  /** Epoch ms the feed last refreshed this symbol; null when the feed omits it. */
  asOf: number | null;
}

export async function fetchQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  if (tickers.length === 0) return {};
  const all = await getAllStocks();
  const bySymbol = new Map(all.map(s => [s.symbol.toUpperCase(), s]));
  const out: Record<string, Quote> = {};
  const missing: string[] = [];
  for (const t of tickers) {
    const hit = bySymbol.get(t.toUpperCase());
    if (hit?.price != null && hit.price > 0) {
      out[t] = { price: hit.price, currency: hit.currency, asOf: hit.asOf };
    } else {
      missing.push(t);
    }
  }
  if (missing.length > 0) {
    // Same single-doc fallback the old code used: the list may not carry every symbol.
    // Pass the ORIGINAL-case ticker — Firestore doc ids are case-sensitive.
    const infos = await Promise.all(missing.map(t => fetchTickerInfo(t).catch(() => null)));
    missing.forEach((t, i) => {
      const info = infos[i];
      if (info?.price != null && info.price > 0) {
        out[t] = { price: info.price, currency: info.currency, asOf: info.asOf ?? null };
      }
    });
  }
  return out;
}
```

Add `asOf` to `TickerInfo` and populate it in
[`fetchTickerInfo`](src/lib/firebasePrices.ts:144) from the same `lastUpdated` field.

Keep `fetchLivePrices` and `fetchPriceCurrencies` as thin derivations of `fetchQuotes` so
nothing else breaks while you migrate:

```ts
export async function fetchLivePrices(tickers: string[]): Promise<Record<string, number>> {
  const q = await fetchQuotes(tickers);
  return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.price]));
}
```

Export the thresholds as named constants so they are tunable in one place:

```ts
/** Older than this and we show a warning but still display the price. */
export const PRICE_WARN_AGE_MS = 24 * 60 * 60 * 1000;
/** Older than this and the price must not be written into snapshot history. */
export const PRICE_SNAPSHOT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
```

**Why 24 h / 48 h and not tighter:** markets close. On a Sunday afternoon the newest
legitimate LSE price is ~48 h old. Anything tighter produces false alarms every weekend.
These two constants are the knob to turn if that judgement turns out wrong.

### Step 2 — snapshots refuse stale inputs

Give [`providerGbpTotal`](src/lib/snapshots.ts:26) and
[`withTodaySnapshots`](src/lib/snapshots.ts:45) an optional `asOf` map and a `now`:

```ts
export function providerGbpTotal(
  p: Provider,
  livePrices: Record<string, number>,
  fxRates: FxRates,
  priceAges: Record<string, number | null> = {},
  now: number = Date.now(),
): number | null {
  if (p.holdings.length === 0) return null;
  let total = 0;
  for (const h of p.holdings) {
    if (h.ticker && h.units != null) {
      if (livePrices[h.ticker] == null) return null;
      const asOf = priceAges[h.ticker];
      // A price we cannot date, or one older than the cutoff, must not become history.
      if (asOf == null || now - asOf > PRICE_SNAPSHOT_MAX_AGE_MS) return null;
    }
    // ...existing native-value + FX logic unchanged
  }
  return total;
}
```

Thread the same two new parameters through `withTodaySnapshots` to its `providerGbpTotal`
call. Defaulting them (`= {}`, `= Date.now()`) keeps every existing call site and test
compiling — but you must still pass the real map from `App.tsx` or the guard does nothing.

**`asOf == null` is deliberately treated as stale.** A price the feed will not date is a
price we cannot vouch for, and history is permanent. Displaying it is fine; recording it is
not.

### Step 3 — `App.tsx`

Replace the two-call price fetch in
[`refreshLivePrices`](src/App.tsx:127) with the single `fetchQuotes`, and keep a
`priceAgesRef` next to the existing `livePricesRef` / `priceCurrenciesRef`:

```ts
const [prices, rates, quotes] = ... // one fetchQuotes + fetchFxRates
const prices  = Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, v.price]));
const ccys    = Object.fromEntries(Object.entries(quotes).flatMap(([k, v]) => v.currency ? [[k, v.currency]] : []));
const ages    = Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, v.asOf]));
```

Pass `ages` into `withTodaySnapshots` at **both** call sites —
[App.tsx:141](src/App.tsx:141) *and* [`handleChange`](src/App.tsx:163). Missing the second
one is the easiest mistake in this plan: `handleChange` snapshots on every user edit.

Add a header warning next to the existing refresh button
([App.tsx:244](src/App.tsx:244)). Compute the newest `asOf` across all quotes; if it is
older than `PRICE_WARN_AGE_MS`, render an amber note reusing the degraded-banner colours:

```tsx
{stalestAsOf != null && Date.now() - stalestAsOf > PRICE_WARN_AGE_MS && (
  <span className="text-xs text-amber-400" title={`Feed last updated ${new Date(stalestAsOf).toLocaleString()}`}>
    Prices may be stale
  </span>
)}
```

### Step 4 — stop calling a stale price "live"

In [HoldingModal](src/components/ISATracker.tsx:940) the green **live** pill is shown
whenever `livePrice != null`. Gate it on freshness: pass the holding's `asOf` in and render
the green pill only when fresh, an amber `stale` pill otherwise. Same for the
`Live price from Firebase` caption at [ISATracker.tsx:951](src/components/ISATracker.tsx:951).

Per [CLAUDE.md](CLAUDE.md), `green-400` means gains and must not be repurposed decoratively
— an amber/slate pill for the stale state is the consistent choice.

### Step 5 — tests

`firebasePrices.test.ts` (extend, following the existing `global.fetch` stub style, and call
`__resetStockCache()` in `beforeEach` as the file already does):

1. `mapDoc` populates `asOf` from a `timestampValue`, and yields `null` when the field is
   absent or unparseable.
2. `fetchQuotes` returns `{ price, currency, asOf }` per ticker and falls back to the
   single-doc endpoint for symbols missing from the list.

`snapshots.test.ts` (extend — this is money maths, so a test is mandatory per
[CLAUDE.md](CLAUDE.md)):

3. `providerGbpTotal` returns a number when the price is 1 hour old.
4. It returns `null` when the price is 72 hours old — even though the price itself is
   present and non-zero.
5. It returns `null` when `priceAges` has no entry for a ticker'd holding.
6. `withTodaySnapshots` leaves `data` **referentially identical** when every provider is
   stale — the existing `changed` short-circuit at
   [snapshots.ts:58](src/lib/snapshots.ts:58) must still hold, because `App.tsx` relies on
   reference equality to skip a redundant save.
7. Holdings with no ticker (cash accounts, `manualValue` only) are unaffected by staleness
   and still snapshot normally.

## Edge cases a weaker model will miss

- **Cash and manual holdings have no price and must not be blocked.** The staleness check
  belongs *only* inside the `h.ticker && h.units != null` branch. Putting it above that
  branch stops every Cash ISA and Savings account from ever snapshotting again.
- **Reference equality is load-bearing.** `withTodaySnapshots` must keep returning the same
  object when nothing changed (its doc comment says so) — `App.tsx` compares
  `snapped !== base` to decide whether to save. Breaking this causes a write on every
  5-minute refresh tick.
- **`Date.parse` on a Firestore `timestampValue`** handles the RFC 3339 `…Z` form correctly,
  but returns `NaN` for junk — hence the explicit `Number.isNaN` guard. Never let `NaN` into
  `asOf`, or `now - asOf > threshold` silently evaluates false and stale prices sail through.
- **Injecting `now`** as a parameter is what makes this testable without fake timers. Do not
  call `Date.now()` inside the loop.
- **The 4-minute list cache** (`STOCK_CACHE_TTL_MS`,
  [firebasePrices.ts:45](src/lib/firebasePrices.ts:45)) means `asOf` values are themselves up
  to 4 minutes behind. Irrelevant against a 24 h threshold — do not add complexity for it.
- **Do not delete existing snapshots.** History already written under the old behaviour stays;
  this plan only stops *new* bad rows. Retroactively deleting user history is not in scope.

## Acceptance criteria

1. `npm run build` clean; `npm test` passes with the new cases.
2. `fetchQuotes` is called **once** per refresh — devtools Network shows one pass over the
   feed per refresh, not two (previously `fetchLivePrices` and `fetchPriceCurrencies` each
   triggered their own).
3. Temporarily lower `PRICE_SNAPSHOT_MAX_AGE_MS` to `1000`, reload, and confirm: prices still
   render, the amber "Prices may be stale" note appears, and **no new entry is appended to
   any provider's `snapshots`** (check via Export data). Restore the constant afterwards.
4. With a healthy feed, a snapshot for today is still written exactly as before.
5. The green "live" pill in the Add/Edit Holding modal appears only for a fresh price.
