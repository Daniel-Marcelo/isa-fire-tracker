# PLAN: Snapshot Accuracy & Daily Performance History (rank 2)

Depends on: PLAN-currency-price-integrity (do that first so snapshot values aren't 100×
wrong for LSE tickers).

## Goal

The Portfolio Performance chart ([src/components/PerformanceChart.tsx](src/components/PerformanceChart.tsx))
is currently misleading, for two reasons:

1. **Snapshots record the wrong number.** Snapshots are only written inside
   `saveHolding()` and `handleCSVImport()` in [src/components/ISATracker.tsx](src/components/ISATracker.tsx)
   (lines ~116–124 and ~167–175). Both compute `h.currentValue ?? h.manualValue ?? 0`
   over **rawData** holdings — but rawData holdings never have `currentValue` (it's a
   runtime-derived field that only exists on the price-applied copy). So the snapshot
   always falls back to `manualValue`, which after a CSV import equals **cost basis**
   (`handleCSVImport` sets `manualValue: ph.costBasis`). The "performance" chart is
   plotting cost basis, not market value.

2. **Snapshots only happen when the user edits a holding.** Live prices refresh every
   5 minutes but never record anything, so history is a handful of points at random
   edit dates.

Fix: move snapshotting into a single pure helper that values holdings from live prices,
call it (a) after every successful price refresh and (b) on every data change, and
delete the two broken inline computations.

Also fix an adjacent robustness bug in the same code path: `refreshLivePrices` in
[src/App.tsx](src/App.tsx) has `try { … } finally { … }` with **no catch** — a network
failure produces an unhandled promise rejection every 5 minutes when offline.

## Files to touch

- **New:** `src/lib/snapshots.ts` — pure snapshot helper
- [src/App.tsx](src/App.tsx) — wire helper into `refreshLivePrices` and `handleChange`; add catch
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — delete both inline snapshot blocks
- [src/components/PerformanceChart.tsx](src/components/PerformanceChart.tsx) — no changes needed (it already converts snapshot GBP → display currency and carries forward the latest snapshot per date)

## Implementation order

### Step 1 — create `src/lib/snapshots.ts`

```ts
import type { AppData, Provider, Holding } from '../types';
import { convertAmount, type FxRates } from './fxRates';

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Value of a holding in its native currency, or null if it cannot be valued reliably
 * (ticker'd holding with units but no live price this session).
 */
export function holdingNativeValue(h: Holding, livePrices: Record<string, number>): number | null {
  if (h.ticker && h.units != null) {
    const price = livePrices[h.ticker];
    if (price != null) return h.units * price;
    return h.manualValue ?? null; // last-saved value beats nothing, but see provider rule below
  }
  return h.manualValue ?? 0;
}

/**
 * Provider total in GBP, or null if the provider can't be valued trustworthily:
 * - any ticker'd holding with units has no live price, or
 * - any holding's currency is missing from fxRates (non-GBP with no rate).
 */
export function providerGbpTotal(p: Provider, livePrices: Record<string, number>, fxRates: FxRates): number | null {
  if (p.holdings.length === 0) return null;
  let total = 0;
  for (const h of p.holdings) {
    if (h.ticker && h.units != null && livePrices[h.ticker] == null) return null;
    const native = holdingNativeValue(h, livePrices);
    if (native == null) return null;
    const currency = h.currency ?? 'GBP';
    if (currency !== 'GBP' && fxRates[currency] == null) return null;
    total += convertAmount(native, currency, 'GBP', fxRates);
  }
  return total;
}

/**
 * Return data with today's snapshot upserted for every valuable provider.
 * MUST return the same object reference when nothing changed, so callers can
 * cheaply skip re-saving.
 */
export function withTodaySnapshots(data: AppData, livePrices: Record<string, number>, fxRates: FxRates): AppData {
  const date = todayKey();
  let changed = false;
  const providers = data.providers.map(p => {
    const total = providerGbpTotal(p, livePrices, fxRates);
    if (total == null) return p;
    const existing = p.snapshots.find(s => s.date === date);
    if (existing && Math.abs(existing.totalValue - total) < 0.01) return p;
    changed = true;
    const snapshots = [...p.snapshots.filter(s => s.date !== date), { date, totalValue: total }]
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ...p, snapshots };
  });
  return changed ? { ...data, providers } : data;
}
```

### Step 2 — wire into `src/App.tsx`

`scheduleSave` is currently declared **after** `refreshLivePrices`. Move the
`scheduleSave` `useCallback` above `refreshLivePrices` (hooks order is fine as long as
the order is identical every render — they're unconditional, so a simple move is safe).

Rewrite `refreshLivePrices`:

```ts
const refreshLivePrices = useCallback(async (base: AppData) => {
  const tickers = [...new Set(base.providers.flatMap(p => p.holdings.map(h => h.ticker).filter(Boolean) as string[]))];
  setLivePricesLoading(true);
  try {
    const [prices, rates] = await Promise.all([
      tickers.length > 0 ? fetchLivePrices(tickers) : Promise.resolve(livePricesRef.current),
      fetchFxRates(),
    ]);
    livePricesRef.current = prices;
    fxRatesRef.current = rates;
    setLivePrices(prices);
    setFxRates(rates);
    const snapped = withTodaySnapshots(base, prices, rates);
    if (snapped !== base) {
      baseData.current = snapped;
      scheduleSave(snapped);
    }
    setData(applyLivePrices(snapped, prices, rates));
    setLivePricesUpdatedAt(new Date());
  } catch (err) {
    console.warn('Live price refresh failed:', err);
  } finally {
    setLivePricesLoading(false);
  }
}, [scheduleSave]);
```

Note the dependency array becomes `[scheduleSave]` (was `[]`). `scheduleSave` itself
depends on `user`, so `refreshLivePrices` changes identity when the user changes — the
`useEffect` that sets up the 5-minute interval lists `refreshLivePrices` in its deps
already, so it re-subscribes correctly. Verify there is no render loop (there isn't:
`scheduleSave` only changes when `user` changes).

Rewrite `handleChange` so user edits also snapshot correctly:

```ts
const handleChange = useCallback((next: AppData) => {
  const snapped = withTodaySnapshots(next, livePricesRef.current, fxRatesRef.current);
  baseData.current = snapped;
  setData(applyLivePrices(snapped, livePricesRef.current, fxRatesRef.current));
  scheduleSave(snapped);
}, [scheduleSave]);
```

### Step 3 — delete the broken inline snapshot code in `ISATracker.tsx`

In `saveHolding()`: delete the `totalVal` reduce and the `snapshots` construction;
return `{ ...p, holdings }` only.

In `handleCSVImport()`: same deletion; keep `lastCsvImport: new Date().toISOString()`,
return `{ ...p, holdings, lastCsvImport: … }`.

After this, `ISATracker` no longer needs `convertAmount` — remove the now-unused import
(`import { convertAmount, type FxRates } from '../lib/fxRates'`) **but keep `FxRates`**:
the `fxRates` prop is still used for native-currency sub-displays. Check with
`npm run lint` for unused imports.

## Edge cases a weaker model would miss

- **Why "skip provider if any priced holding is missing a price":** on first load, or
  when the feed is down, `fetchLivePrices` returns a partial/empty map. Falling back to
  `manualValue` for ticker'd holdings would record cost-basis-ish numbers again — the
  exact bug we're removing. Recording nothing for that provider today is strictly
  better; yesterday's snapshot carries forward in the chart.
- **`fetchFxRates` failure returns `{ GBP: 1 }`, not `{}`.** The old guard in
  `convertAmount` (`Object.keys(rates).length === 0`) therefore never triggers, and a
  USD holding would silently convert at rate 1. That's why `providerGbpTotal` must
  explicitly check `fxRates[currency] == null` and bail, rather than trusting
  `convertAmount`.
- **`convertAmount` GBp special case:** holding currencies are `'GBP'` post-modal, but
  a legacy holding could conceivably carry `'GBp'`; `convertAmount`'s `normalise()`
  handles that. Don't re-implement conversion in the helper — always go through
  `convertAmount`.
- **Same-reference return contract.** If `withTodaySnapshots` returns a fresh object
  every call, every 5-minute refresh triggers a Supabase write even when nothing moved,
  and `handleChange`→`scheduleSave` loops become plausible. The `changed` flag +
  0.01 epsilon is load-bearing; don't simplify it away.
- **Snapshots are stored in GBP by design** — `PerformanceChart` converts GBP → display
  currency at render time (`convertAmount(snap.totalValue, 'GBP', currency, fxRates)`).
  Do not store display-currency values.
- **UTC date key.** `toISOString().slice(0,10)` is UTC, so between midnight UTC and
  local midnight a "today" snapshot may land on what the user considers yesterday.
  The existing code already does this; keep it consistent rather than fixing it here
  (changing the key format would orphan existing snapshots).
- **Provider with all holdings deleted today:** an earlier snapshot from the same day
  remains at its last nonzero value (we skip empty providers). Acceptable; do not
  record zeros for empty providers — a provider the user just created would otherwise
  chart a bogus £0 point.
- **`m % 12` FIRE code is unrelated** — don't touch `FIRECalculator.tsx` in this plan.

## Acceptance criteria

1. `npm run build` and `npm run lint` pass.
2. Fresh sign-in with at least one ticker'd holding: within a few seconds of load
   (after prices arrive), the provider gains a snapshot for today whose `totalValue`
   equals units × live price (converted to GBP), **not** the cost basis. Verify by
   exporting JSON and inspecting `snapshots`, or via the Supabase row.
3. Reload the app 3 times in a row: still exactly **one** snapshot for today per
   provider (upsert, no duplicates), and no Supabase save fires when the value hasn't
   moved (watch the sync indicator / network tab — after the first snapshot write,
   later reloads with unchanged prices cause no `user_data` upsert).
4. Editing a holding's units immediately updates today's snapshot to the new market
   value (export and check).
5. With devtools set to "Offline", the app doesn't spam unhandled promise rejections;
   the console shows the "Live price refresh failed" warning at most once per interval
   and existing values remain on screen.
6. CSV import into a provider: today's snapshot reflects live-priced market value once
   prices are loaded (not the imported cost basis). If a just-imported ticker has no
   price in the feed, no new snapshot is written for that provider (check exported
   JSON) — and no crash.
7. The Performance chart renders unchanged for old data (backwards compatible: old
   snapshots are still GBP totals).
