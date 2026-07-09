# PLAN: Money-pipeline regression tests (rank 5)

## Goal

This is a finance app: a silent currency or cost-basis error is worse than a crash. The
pure engine (`fireEngine`, `fireProjection`, `monteCarlo`) is well tested (37 cases), but
the **money display pipeline** — the chain that turns stored native-currency holdings into
on-screen display-currency values — has thin coverage and is exactly where the rank-1 and
rank-3 bugs live. Add focused regression tests that lock in correct currency behaviour end
to end, so future edits (or a currency-switch refactor) can't silently reintroduce a 100×
or double-conversion error.

This plan is **test-only** — no product code changes. It's ranked last because it delivers
most value **after** the rank-1 and rank-3 fixes land (it then guards them); if run before,
some assertions below will (correctly) fail and document the bugs.

## Files to touch

- [src/lib/applyLivePrices.test.ts](src/lib/applyLivePrices.test.ts) — extend
- [src/lib/snapshots.test.ts](src/lib/snapshots.test.ts) — extend
- **New:** `src/lib/currencyRoundTrip.test.ts` — export→import→switch invariants
- **New:** `src/lib/fxRates.test.ts` assertions if gaps exist (a file already exists —
  extend rather than duplicate)

Use the existing test helpers as templates (`makeProvider`, `makeData` in
`applyLivePrices.test.ts`).

## Implementation order

### Step 1 — non-GBP live-price correctness (`applyLivePrices.test.ts`)

Assert the invariant that a US holding renders correctly regardless of display currency:

- Holding `{ ticker: 'AAPL', units: 10, currency: 'USD', costBasis: 1000 }`, display
  currency `GBP`, `rates = { GBP: 1, USD: 1.25 }`, `prices = { AAPL: 250 }` (USD).
  Expect `currentPrice ≈ 200` (250 ÷ 1.25) and `currentValue ≈ 2000`, and
  `costBasis ≈ 800` (1000 ÷ 1.25). This is the case the rank-1 bug breaks when `currency`
  is missing.
- Same holding, display currency `USD`: `currentPrice === 250`, `currentValue === 2500`,
  `costBasis === 1000` (identity).

**Edge case to encode:** a GBp/pence-priced holding. Because the feed normalises GBp→GBP
÷100 *before* prices reach `applyLivePrices`, a holding stored `currency: 'GBP'` with
`prices = { ISF: 10.382 }` (already pounds) must value at `units × 10.382`, **not**
÷100 again. Add this assertion so nobody re-adds pence handling downstream.

### Step 2 — snapshot currency & trust rules (`snapshots.test.ts`)

- `providerGbpTotal` converts a `USD` holding to GBP using `fxRates` (assert the GBP number).
- Returns `null` when a ticker'd holding with units has no live price (already the rule —
  pin it so the rank-3 fix, which *reduces* how often this happens, doesn't accidentally
  weaken the "don't snapshot untrustworthy data" guarantee).
- Returns `null` when a non-GBP holding's currency is absent from `fxRates`.
- `withTodaySnapshots` returns the **same object reference** when nothing changed (callers
  rely on this to skip re-saving — see `App.tsx` `refreshLivePrices`). Assert
  `result === input` for a no-op day.

### Step 3 — export/import/currency-switch round trip (`currencyRoundTrip.test.ts`)

This is the highest-value new file. It encodes the invariant that raw stored state
survives the JSON round trip and a display-currency change without drift.

- Build `AppData` with a mix: a GBP ticker holding, a USD ticker holding (with
  `costBasis` in USD), and a cash `Savings` provider (`manualValue`, no ticker).
- **Round trip:** `migrateAppData(JSON.parse(JSON.stringify(exportShape(data))))` deep-
  equals the stripped original (use `stripDerived` semantics — no `currentPrice`/
  `currentValue` keys leak). `store.ts` already exposes `stripDerived`, `migrateAppData`,
  and the `exportData` cleaning logic; factor the cleaning into a tiny local helper in the
  test rather than invoking the DOM download.
- **Currency-switch idempotence:** apply `applyLivePrices(base, prices, rates)` at display
  `GBP`, then at `USD`, then back at `GBP`; the `GBP` result's `costBasis` and
  `currentValue` for every holding must match the first `GBP` result to within a cent.
  This is the guarantee the app already claims in commit `4c223f8` ("always converting from
  baseData") — pin it so it can't regress.

**Edge case a weaker model will miss:** `applyLivePrices` must always be applied to the
**raw** `baseData`, never to already-derived data. Write the round-trip test to convert
from the same raw base each time (mirroring `App.tsx`'s `baseData.current` pattern), not by
feeding one `applyLivePrices` output into the next — feeding derived output back in is the
exact bug class these tests exist to catch, so demonstrate the correct pattern.

### Step 4 — CSV import currency (only if rank-1 has landed)

If [PLAN-08-07-round-csv-import-currency.md](PLAN-08-07-round-csv-import-currency.md) is
done, add to `csvParsers.test.ts`: parse a Trading 212 fixture with a USD instrument and
assert the returned holding carries `currency: 'USD'` and a USD-denominated `costBasis`.
If rank-1 is **not** done, add this test as `it.todo(...)` so the gap is visible in the
test report without failing CI.

## Acceptance criteria

1. `npm test` passes (after rank-1 and rank-3 land) with the new files/cases; test count
   rises by ~12–15.
2. Deliberately reverting the rank-1 fix (drop `currency` on CSV import, or revert the
   feed-currency decoupling) makes the Step 1 non-GBP assertions **fail** — proving the
   tests actually guard the bug, not just pass vacuously.
3. The currency-switch idempotence test fails if someone changes `applyLivePrices` to read
   from derived state — proving it guards the `baseData` invariant.
4. No product code is modified by this plan; `git diff --stat` shows only `*.test.ts`
   files.
5. Every new test is deterministic (fixed `rates`/`prices` objects, no `Date.now()` in
   assertions except via the existing `todayKey()` which the snapshot tests may stub).
