# PLAN: Test Harness for the Money Math (rank 3)

## Goal

This repo has zero tests, yet its core value is arithmetic: currency conversion, CSV
cost-basis aggregation, live-price application, FIRE projection. The git history shows
the cost of that: `5df55f9 Fix operator precedence bug in currentValue sum reductions`
and `4c223f8 Fix currency change compounding values` are both regressions in pure math
that a 10-line test would have caught. Set up Vitest, extract the pure logic that's
currently trapped inside components, and pin down the behaviours with unit tests —
including regression tests for the bugs fixed in PLAN-currency-price-integrity and
PLAN-snapshot-accuracy (write tests for whichever of those have landed; if they
haven't, test current behaviour minus the known bugs and leave TODOs).

## Files to touch

- [package.json](package.json) — add `vitest` devDependency and `"test": "vitest run"` script
- **New:** `src/lib/applyLivePrices.ts` — extracted from [src/App.tsx](src/App.tsx)
- **New:** `src/lib/fireProjection.ts` — extracted from [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx)
- [src/App.tsx](src/App.tsx) — import `applyLivePrices` instead of defining it inline
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — import projection functions
- **New tests:** `src/lib/fxRates.test.ts`, `src/lib/csvParsers.test.ts`,
  `src/lib/applyLivePrices.test.ts`, `src/lib/fireProjection.test.ts`,
  and `src/lib/snapshots.test.ts` (only if PLAN-snapshot-accuracy has landed)

## Implementation order

### Step 1 — install and configure

```
npm install -D vitest
```

Add to `package.json` scripts: `"test": "vitest run"`. No `vitest.config.ts` is needed:
all tests below are pure Node (no DOM). Do **not** install jsdom or testing-library —
out of scope.

In each test file, import explicitly (`import { describe, it, expect } from 'vitest'`)
rather than relying on globals, so no tsconfig/eslint globals changes are required.
If `tsc -b` (run by `npm run build`) complains about test files, add
`"exclude": ["**/*.test.ts"]`… it won't by default since `tsconfig.app.json` includes
`src` — check whether build passes with test files present; if it fails on vitest
imports, the fix is adding `"types": ["vitest/globals"]`? No — the correct fix is that
explicit imports need no types entry. Only act if the build actually breaks.

### Step 2 — extract `applyLivePrices` out of `App.tsx`

Create `src/lib/applyLivePrices.ts` containing the `applyLivePrices(base, prices, rates)`
function currently defined inside the `App` component (App.tsx ~lines 64–93), plus its
imports (`convertAmount`, types). It closes over nothing from component state — it's
already pure; move it verbatim, exported. Update `App.tsx` to import it. Behaviour must
be byte-identical.

### Step 3 — extract FIRE math

Create `src/lib/fireProjection.ts` with `realMonthlyRate`, `findFireAges`, `project`,
the `ProjectionResult` interface, and the `DEFAULT_SWR` constant — all currently at
module scope in `FIRECalculator.tsx` (lines ~14–129). Export them; import into the
component. No logic changes.

### Step 4 — write the tests

**`fxRates.test.ts`** (`convertAmount`):
- GBP→GBP identity; USD→GBP with `{ GBP: 1, USD: 1.25 }` gives `amount / 1.25`.
- `GBp` input: `convertAmount(250, 'GBp', 'GBP', rates)` → `2.5` (pence normalisation).
- Unknown currency falls back to rate 1 (documenting current — arguably bad — behaviour):
  `convertAmount(100, 'XYZ', 'GBP', { GBP: 1 })` → `100`. Mark with a comment that this
  silent fallback is why `providerGbpTotal` (snapshots) checks rates explicitly.

**`csvParsers.test.ts`** — build fixture CSVs as inline template strings. The parsers
index columns by header name, so a minimal header with the exact column names works.
Trading 212 header columns used: `Action`, `Ticker`, `Name`, `No. of shares`,
`Price / share`, `Currency (Price / share)`, `Exchange rate`, `Total`,
`Currency (Total)`. Cases:
- Two buys of the same ticker aggregate units and costBasis.
- Sell reduces costBasis **proportionally**: buy 10 @ £100 total, sell 5 → costBasis 50, units 5.
- Sell more than held clamps at 0 (no negatives).
- `Stock split close` then `Stock split open` changes units, preserves costBasis.
- Quoted field containing a comma (`"Apple, Inc."`) parses as one field (exercises `parseCSVRow`).
- Currency resolution: (a) `Currency (Total)` matches user currency → uses Total;
  (b) `Currency (Price / share)` matches → uses price × shares; (c) neither matches →
  Total × exchange rate.
- Holdings with zero remaining units are excluded from output.
- Freetrade: buy/sell with headers `Type,Symbol,Title,Quantity,Total Amount`.
- HL: header row not on line 0 (put a junk line before the header containing
  `Stock Description`); buy via type `Purchase`; values with `£` and thousands commas parse.

**`applyLivePrices.test.ts`**:
- Ticker'd holding with units and a live price: `currentValue = units × conv(price)`.
- Live price present but `units == null`: falls back to converted `manualValue`.
- No live price: `currentPrice` undefined, `currentValue = conv(manualValue)`.
- `costBasis` converts from holding currency to user currency; holding without
  `costBasis` gains no `costBasis` key.
- User currency USD, holding currency GBP, rates `{ GBP: 1, USD: 2 }`: values double.
- Regression (after PLAN-currency-price-integrity): prices arrive already in pounds —
  assert a GBP holding with price 10.38 values 10 units at 103.8, and note in a comment
  that pence normalisation is firebasePrices' job, tested implicitly by this contract.

**`fireProjection.test.ts`** (use tolerant assertions, `toBeCloseTo` / ranges):
- `realMonthlyRate(7, 3)` ≈ `(1.07/1.03)^(1/12) - 1`.
- Zero contributions, zero savings, nonzero expenses → both fire ages `null`.
- Huge starting pot (e.g. accessible 10× the SWR target, age 30, access age 57):
  `earlyFireAge` = 30 (immediate).
- Pot exactly at pension target but all in pension, age 30: `earlyFireAge` null
  (no bridge), `fullFireAge` = pension access age (57).
- `project()` points: first point age = currentAge, points are yearly, ~51 entries
  (m 0..600 stepping 12), monotonic ages.
- Balances never negative in output (`Math.max(…, 0)` clamping).

**`snapshots.test.ts`** (only if `src/lib/snapshots.ts` exists):
- Upserts today's snapshot at units×price converted to GBP.
- Returns the **same object reference** when totals are within 0.01.
- Provider skipped when a ticker'd holding lacks a live price.
- Provider skipped when a holding currency has no fx rate.
- Existing other-day snapshots preserved and sorted.

### Step 5 — run everything

`npm test`, `npm run lint`, `npm run build` — all green.

## Edge cases a weaker model would miss

- **Don't test `importData`/`exportData` directly** — they use `FileReader`/`Blob`/DOM
  and would drag jsdom in. If PLAN-currency-price-integrity landed, `migrateAppData`
  in `store.ts` is pure — test *that* instead (legacy `currentValue` → `manualValue`
  migration, derived-field stripping, `contributions ?? []`).
- **`store.ts` imports `db.ts`? No — but check before testing `store.ts`:** importing a
  module that transitively imports `supabase.ts` executes `createClient` with
  `import.meta.env` — fine under Vitest (it supports `import.meta.env`), but env vars
  are undefined, which only triggers the `console.warn`, not a crash. If a test run
  crashes on supabase import, stub via `vi.mock('./supabase')` — but you shouldn't need
  to for the files listed above (none import supabase).
- **`parseTrading212` treats `Total` as already-absolute?** No — it wraps in
  `Math.abs`. Write sell fixtures with negative totals to prove sign-safety.
- **The T212 "neither currency matches" branch multiplies by the exchange rate** —
  the comment in the code explains rate = priceCurrency per totalCurrency. Build the
  fixture so the expected number is hand-computable (e.g. total 80 GBP, rate 1.25,
  user currency USD → 100).
- **Float formatting:** parsers run `toFixed(8)`/`toFixed(2)` before returning — assert
  against the rounded values, or use `toBeCloseTo`, never exact float equality on
  derived sums.
- **`findFireAges` mutates nothing but is O(600×600) worst case** — tests are still
  instant; don't "optimise" it while extracting. Extraction must be a pure move.
- **Vite HMR:** after extracting `applyLivePrices`, confirm `App.tsx` has no leftover
  unused imports (`convertAmount` may become unused there — check; `convertAmount` is
  still used? In current App.tsx it's only used inside applyLivePrices and imported at
  top. After extraction remove it, but keep `fetchFxRates` and the `FxRates` type import
  which are used elsewhere in the file).

## Acceptance criteria

1. `npm test` runs a suite of ≥ 25 assertions across the 4–5 test files, all passing,
   in under ~10 seconds, with no network access (no fetch mocking needed because none
   of the tested modules fetch).
2. `npm run build` and `npm run lint` still pass (extractions didn't break the app
   build; test files don't break `tsc -b`).
3. `App.tsx` no longer defines `applyLivePrices` inline; `FIRECalculator.tsx` no longer
   defines `project`/`findFireAges`/`realMonthlyRate` at module scope — both import
   from `src/lib/`.
4. The app behaves identically: run `npm run dev`, sign in, confirm portfolio values
   and the FIRE projection chart render with the same numbers as before the refactor.
5. Deliberately re-introduce the old precedence bug locally
   (`sum + p.holdings.reduce(...)` style change in `applyLivePrices` — or any one-char
   math mutation) and confirm at least one test fails; revert. (This validates the
   tests actually bite; note the result in the PR/commit description.)
