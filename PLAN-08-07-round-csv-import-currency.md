# PLAN: CSV import currency integrity (rank 1 — do this first)

## Goal

Fix a silent money-corruption bug on the app's primary bulk-entry path (Portfolio →
Import CSV). Holdings created by CSV import are stored **without a `currency`** and their
cost basis is baked into whatever *display* currency was active at import time. Two
concrete symptoms:

1. **US (and other non-GBP) tickers show wrong values.** A holding created by
   `handleCSVImport` in [src/components/ISATracker.tsx](src/components/ISATracker.tsx)
   has no `currency`, so `applyLivePrices` in
   [src/lib/applyLivePrices.ts](src/lib/applyLivePrices.ts) treats it as `GBP`. The live
   price for e.g. `AAPL` arrives from the feed in **USD**, but is converted as if it were
   GBP, so a $230 share is rendered as £230 (or mis-converted). Manually-added holdings
   are correct because `HoldingModal` sets `currency` from the feed
   (`setNativeCurrency(info.currency...)`); the CSV path is the only one that drops it.
2. **Cost basis breaks on a later currency switch.** The parsers convert `costBasis`
   into the *display* currency (the `currency` argument), but the stored holding is
   tagged (defaulted) `GBP`. When the user later switches display currency,
   `applyLivePrices` re-converts that already-converted cost basis from `GBP`, double-
   converting it. Manual holdings don't have this problem because their cost is stored in
   the holding's own native currency.

Also fix a latent parsing bug that makes symptom 1 worse: **`parseCSVRow` does not strip
`\r`**, so Windows/CRLF broker exports (Trading 212 exports are CRLF) leave a trailing
`\r` on the **last column of every row** — which for Trading 212 is `Currency (Total)`
and `ID`. That corrupts currency matching and dividend dedupe ids.

## Design decision (read before touching code)

The `Holding` model has a **single** `currency` field that governs both cost basis and
price. The established invariant (set by the manual `HoldingModal` path) is:

> `holding.currency` = the instrument/price currency, and `costBasis` / `manualValue`
> are expressed in that same currency.

The fix makes the CSV path honour that invariant, plus adds a decoupling safety-net in
`applyLivePrices` so the **live price currency comes from the feed**, not from the
holding — this makes even providers that only export account-currency totals (Freetrade,
HL) render correct live values.

## Files to touch

- [src/lib/csvParsers.ts](src/lib/csvParsers.ts) — strip `\r`; capture per-ticker
  instrument currency; return it on each `ParsedHolding`
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — `handleCSVImport`:
  set `currency` on imported holdings
- [src/lib/applyLivePrices.ts](src/lib/applyLivePrices.ts) — take price currency from the
  feed via a new `priceCurrencies` argument (backward-compatible)
- [src/lib/firebasePrices.ts](src/lib/firebasePrices.ts) — export the price currencies
  alongside prices
- [src/App.tsx](src/App.tsx) — thread the price-currency map through
- [src/lib/csvParsers.test.ts](src/lib/csvParsers.test.ts) and
  [src/lib/applyLivePrices.test.ts](src/lib/applyLivePrices.test.ts) — new assertions

No Supabase schema change: `currency` is just a string inside the JSONB blob. Old CSV-
imported holdings (already stored `GBP`) keep rendering; new imports are correct.

## Implementation order

### Step 1 — `parseCSVRow` CRLF fix (smallest, highest-value)

In `csvParsers.ts`, the final `result.push(current)` in `parseCSVRow` includes any
trailing `\r`. Change the function so the last field is trimmed of a single trailing
carriage return. Do **not** blanket-`trim()` every field (leading/trailing spaces in
names are legitimate); only strip `\r`:

```ts
result.push(current.replace(/\r$/, ''));
```

Do this for the mid-row push too (defensive), or simpler: at the top of `parseCSVRow`,
`line = line.replace(/\r$/, '')`. Prefer the top-of-function form — one line, covers
every column.

### Step 2 — capture instrument currency per holding in the parsers

Extend `ParsedHolding`:

```ts
export interface ParsedHolding {
  ticker: string;
  name: string;
  units: number;
  costBasis: number;   // total invested, in `currency` below
  currency: string;    // currency costBasis is expressed in
}
```

- **Trading 212** (`parseTrading212`): the per-row `Currency (Price / share)` column
  (`iPriceCurrency`) is the instrument currency. Store it on the map entry the first time
  a ticker is seen. Convert cost into that instrument currency: for a `Market buy`, native
  cost for the row is `rawPrice * shares` (price is already in `priceCurrency`). **Edge
  case a weaker model will miss:** the existing code sometimes uses `Total × exchangeRate`
  as the cost. To keep cost and `currency` consistent you must express cost in
  `priceCurrency`. Use `Math.abs(rawPrice * shares)` as the per-row cost whenever
  `rawPrice > 0`; fall back to the existing `total` logic only when `rawPrice` is 0/blank,
  and in that fallback set the entry currency to the currency that `total` ended up in.
  Keep the existing proportional sell reduction untouched.
- **Freetrade** (`parseFreetrade`) and **HL** (`parseHL`): these exports only give
  account-currency totals and no reliable per-instrument currency. Set
  `currency = accountCurrency` (Freetrade: `Account Currency` column, default the
  `currency` param; HL: always `GBP`). Cost stays as the account-currency total. The
  Step 4 feed decoupling is what makes their live *values* correct despite this.

Set `currency` on every returned holding. Keep the `currency` **parameter** of `parse`
(still used for the Trading-212 `Total`-matches-user branch and dividends).

### Step 3 — persist `currency` on import

In `handleCSVImport` (ISATracker.tsx), both the `replace` and `merge` branches build
holdings. Add `currency: ph.currency` to each newly-created holding object (the two
`{ id: uid(), name: ..., ticker: ..., units: ..., manualValue: ..., costBasis: ... }`
literals). **Edge case:** in the merge branch, when summing into an existing holding
(`match.units += ...`), do **not** overwrite the existing holding's `currency` — a
re-import must not flip a manually-set currency. Leave `match.currency` as-is.

### Step 4 — price currency from the feed (the general safety net)

Today `applyLivePrices` computes `currentPrice = conv(livePrice, holding.currency)`. The
feed already knows each stock's currency (`StockResult.currency`, parsed in
`getAllStocks`). Expose it and use it for the *price* only.

In `firebasePrices.ts`, add:

```ts
export async function fetchPriceCurrencies(tickers: string[]): Promise<Record<string, string>> {
  if (tickers.length === 0) return {};
  const all = await getAllStocks();
  const bySymbol = new Map(all.map(s => [s.symbol.toUpperCase(), s.currency]));
  const out: Record<string, string> = {};
  for (const t of tickers) {
    const c = bySymbol.get(t.toUpperCase());
    if (c) out[t] = c;
  }
  return out;
}
```

Change `applyLivePrices`'s signature to accept an optional map and use it for the price
side only (cost basis still uses `holding.currency`):

```ts
export function applyLivePrices(
  base: AppData,
  prices: Record<string, number>,
  rates: FxRates,
  priceCurrencies: Record<string, string> = {},
): AppData {
  ...
  const priceCcy = holding.ticker ? (priceCurrencies[holding.ticker] ?? hCurrency) : hCurrency;
  if (livePrice !== undefined) {
    const currentPrice = conv(livePrice, priceCcy);
    const currentValue = holding.units != null
      ? holding.units * currentPrice
      : conv(holding.manualValue ?? 0, hCurrency);   // manualValue stays in holding.currency
    ...
```

**Edge case a weaker model will miss:** the feed already normalises pence (`GBp`/`GBX`)
to `GBP` in `normalisePence`, so `priceCurrencies` will never contain `GBp`. Do **not**
add pence handling here; `convertAmount` already has a `GBp` safety net and adding another
would double-divide. Default `priceCurrencies = {}` keeps every existing caller and all
current tests working unchanged (falls back to `hCurrency`).

### Step 5 — thread it through App.tsx

In `App.tsx`, `refreshLivePrices` currently fetches `prices` and `rates`. Also fetch
`fetchPriceCurrencies(tickers)` in the same `Promise.all`, keep it in a `priceCurrenciesRef`
(mirror the `livePricesRef` pattern so `handleChange` can read it without a stale
closure), store it in state, and pass it as the 4th arg to **both** `applyLivePrices`
calls (in `refreshLivePrices` and in `handleChange`). Nothing else consumes it.

### Step 6 — tests

- `csvParsers.test.ts`: for the existing Trading 212 fixtures, assert each returned
  holding has a `currency` equal to the row's `Currency (Price / share)`. Add a fixture
  with `\r\n` line endings and assert the last column (Currency/ID) is parsed without a
  trailing `\r` (e.g. a dividend's `currency` is `'GBP'`, not `'GBP\r'`).
- `applyLivePrices.test.ts`: add a test where `holding.currency = 'GBP'` (simulating an
  old CSV holding) but `priceCurrencies = { AAPL: 'USD' }` and `rates = { GBP: 1, USD: 1.25 }`;
  assert `currentPrice` equals the USD price converted to GBP (price × 1/1.25), proving
  the price currency now comes from the feed, not the holding.

## Acceptance criteria

1. `npm test` passes, including the new assertions.
2. Importing a Trading 212 CSV containing a USD holding, with display currency GBP,
   results in a holding whose `currency` is `USD` and whose on-screen value equals
   `units × (USD live price ÷ GBPUSD rate)` — not `units × USDprice` treated as GBP.
   (Verify in the running app: add a provider, Import CSV, expand it, check the value
   against the broker.)
3. Switching display currency GBP→USD→GBP leaves every imported holding's cost basis
   unchanged when it returns to GBP (no drift), matching the behaviour of manually-added
   holdings.
4. A CRLF-exported Trading 212 file imports with dividends whose `currency` is a clean
   ISO code (no `\r`), and the "Currency (Total) matches user currency" branch still fires.
5. Old holdings already stored without `currency` still render (they fall back to `GBP`
   for cost, feed currency for price) — no crash, no NaN.
