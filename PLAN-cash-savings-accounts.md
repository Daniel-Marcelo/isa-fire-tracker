# PLAN: Cash & Savings Accounts (rank 1 — do this first)

## Goal

The app tracks only invested holdings. Real households hold cash — emergency fund,
Cash ISAs, Premium Bonds, savings accounts — and today there is nowhere to put them, so
"Total portfolio", the accessible/pension split, and the FIRE projection starting pots
are all understated. (`FireSettings.currentSavings` exists in
[src/types.ts](src/types.ts) but is dead code — grep confirms it is only referenced in
`store.ts` defaults and never used in any calculation.)

Add two new account types — **`Cash ISA`** and **`Savings`** — reusing the existing
Provider/Holding model (a cash account is a provider whose holdings are ticker-less
balances). This makes cash flow through totals, allocation charts, snapshots and the
FIRE calculator with almost no new plumbing, because everything already reduces over
`provider.holdings`.

## Files to touch

- [src/types.ts](src/types.ts) — extend `AccountType` union
- [src/utils.ts](src/utils.ts) — add centralised account-type helper sets
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — `ACCOUNT_TYPES` list, pension-split call sites, cash-aware `HoldingModal`
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — `ACCESSIBLE_TYPES` call site
- [src/components/AllocationCharts.tsx](src/components/AllocationCharts.tsx) — colours for new types
- [src/components/LookThrough.tsx](src/components/LookThrough.tsx) and [src/components/ExposureCharts.tsx](src/components/ExposureCharts.tsx) — exclude cash providers

No Supabase/schema change: `AppData` is stored as one JSONB blob (`user_data.data`),
and `accountType` is just a string inside it. `migrateAppData` in
[src/store.ts](src/store.ts) needs **no change** for this feature.

## Implementation order

### Step 1 — types and shared helper sets

In `src/types.ts`:

```ts
export type AccountType = 'ISA' | 'SIPP' | 'GIA' | 'Workplace Pension' | 'Cash ISA' | 'Savings';
```

In `src/utils.ts` add (and export):

```ts
export const PENSION_ACCOUNT_TYPES = new Set<string>(['SIPP', 'Workplace Pension']);
export const CASH_ACCOUNT_TYPES = new Set<string>(['Cash ISA', 'Savings']);
export function isPensionType(t?: string) { return PENSION_ACCOUNT_TYPES.has(t ?? ''); }
export function isCashType(t?: string) { return CASH_ACCOUNT_TYPES.has(t ?? ''); }
```

### Step 2 — replace the three divergent accessible/pension splits

There are **two different split conventions in the codebase today** and they will
disagree for any new type if you don't fix both:

1. `ISATracker.tsx` (~line 196 and ~line 220): defines a local
   `PENSION_TYPES = new Set(['SIPP', 'Workplace Pension'])` and computes
   `accessible = total − pension`. New types land in "accessible" automatically. ✔
2. `FIRECalculator.tsx` (~line 131): `ACCESSIBLE_TYPES = new Set(['ISA', 'GIA'])` with
   filter `!p.accountType || ACCESSIBLE_TYPES.has(p.accountType)` — an **allowlist**.
   A `Savings` provider would be counted in the Portfolio tab totals but **silently
   dropped from the FIRE projection**. This is the trap.

Fix: delete both local set definitions and use the shared helpers. In
`FIRECalculator.tsx`, change the accessible filter to
`!p.accountType || !isPensionType(p.accountType)` (i.e. everything that isn't a pension
is accessible — matches ISATracker's convention). Keep the pension filter as
`isPensionType(p.accountType)`.

### Step 3 — offer the new types in the provider form

In `ISATracker.tsx` (~line 680): `const ACCOUNT_TYPES: AccountType[] = ['ISA', 'SIPP', 'GIA', 'Workplace Pension', 'Cash ISA', 'Savings'];`
The filter chips row (`accountTypes = ['All', ...ACCOUNT_TYPES]`) picks this up
automatically. On mobile the chips row will wrap — it already uses `flex-wrap`, fine.

### Step 4 — cash-aware HoldingModal

`HoldingModal` (in `ISATracker.tsx`) is stock-oriented: search box, units, price, avg
cost. For a cash account that UI is wrong. Pass the provider's `accountType` into the
modal (both call sites: `showAddHolding` — store the provider object or look it up by
id — and `editHolding`). When `isCashType(accountType)`:

- Replace the "Stock / Fund" search input with a plain "Account name" text input bound
  to `name` (skip the `searchStocks` effect entirely — guard the effect with the flag).
- Hide Units, Price and Avg-cost inputs. Show a single **Balance** input bound to
  `manualValue` and a **currency `<select>`** over `SUPPORTED_CURRENCIES` bound to
  `nativeCurrency`. (Today `nativeCurrency` is only ever set by ticker selection —
  there is no manual currency control, so a EUR cash balance is impossible without
  this select.)
- `handleSubmit` for cash: save `{ name, manualValue: Number(balance), currency: nativeCurrency }`
  with `ticker`, `units`, `costBasis` all `undefined`.

Ticker-less holdings already flow correctly through `applyLivePrices` in
[src/App.tsx](src/App.tsx) — the no-live-price branch converts `manualValue` from the
holding currency to display currency. No change needed there.

### Step 5 — allocation chart colours

In `AllocationCharts.tsx` add to `ACCOUNT_TYPE_COLOURS`:
`'Cash ISA': '#22d3ee', 'Savings': '#64748b'` (any distinct hex is fine; without this
they fall back to grey `#94a3b8`, same as 'Other' — visually ambiguous).

### Step 6 — keep cash out of Look-through

In `LookThrough.tsx` and `ExposureCharts.tsx`, change
`const allHoldings = data.providers.flatMap(p => p.holdings)` to filter first:
`data.providers.filter(p => !isCashType(p.accountType)).flatMap(...)`.

Why this matters (subtle): `LookThrough` classifies any holding whose **name** matches
`FUND_KEYWORDS = /\b(etf|fund|ucits|trust|index|oeic|vct|reit|accumulation|income)\b/i`
as an unmatched fund. A cash holding named "NS&I **Income** Bonds" or "Vanguard Cash
**Fund**" would appear in the Fund Exposure card flagged "No holdings uploaded".
`ExposureCharts` is safer (its `directHoldings` requires `h.ticker`) but excluding at
the source keeps `totalPortfolio`/covered-% denominators consistent too.

### Step 7 — summary card label

In `ISATracker.tsx` the summary card labelled "ISA / GIA" is actually
`total − pension`, which now includes cash. Rename the label to "ISA / GIA / Cash"
(both the SummaryCard at ~line 212 and the two income-snapshot sub-labels at
~lines 238/256 that say "ISA / GIA"). Same for the "ISA / GIA" pot card label in
`FIRECalculator.tsx` (~line 188) → "ISA / GIA / Cash".

## Edge cases a weaker model would miss

- **The FIRECalculator allowlist vs ISATracker denylist divergence** (step 2). If you
  only add the types to `ACCOUNT_TYPES`, the Portfolio and FIRE pages show different
  accessible totals and nothing errors.
- **`data` vs `rawData`**: `ISATracker` receives both. Any `onChange` must spread
  `rawData` (native currencies, no derived fields), never `data` (display-converted).
  The existing `saveHolding` already does this correctly — don't "simplify" it.
- **Currency select for cash**: without step 4's select, non-GBP cash silently defaults
  to `currency: 'GBP'` and is mis-valued after any FX conversion.
- **Snapshots**: `saveHolding` writes a per-provider snapshot converted **to GBP**
  (see the `convertAmount(val, h.currency ?? 'GBP', 'GBP', fxRates)` reduce). Cash
  balances flow through this untouched — do not add a separate snapshot path.
- **FIRE growth assumption**: cash now compounds at `expectedAnnualReturn` like
  equities. That's an accepted v1 simplification — add a one-line hint under the FIRE
  "ISA / GIA / Cash" pot card ("includes cash; growth assumption applies to the whole
  pot") rather than building per-type return rates.
- **Old persisted data** contains only the four original strings; the union widening is
  backwards-compatible, and TypeScript will surface any `switch`/`Set` sites you missed
  only if they're typed — the two `Set<string>` locals are untyped, which is exactly
  why step 2 deletes them.

## Acceptance criteria

1. `npm run build` passes (tsc + vite).
2. Create a provider with type `Savings`, add a holding "Emergency fund", balance
   10,000, currency GBP: Total portfolio rises by £10,000; the "ISA / GIA / Cash" card
   rises by £10,000; Pension card unchanged.
3. The FIRE page "ISA / GIA / Cash" pot equals the Portfolio page accessible total
   (previously a `Savings` provider would be missing there).
4. The cash holding's add/edit modal shows only Name + Balance + Currency (no ticker
   search, units, price, or avg-cost fields), and editing an existing stock holding in
   an `ISA` provider still shows the full stock UI.
5. Add a `Savings` holding named "Income Bonds": it does **not** appear on the
   Look-through page (neither in Fund Exposure nor charts).
6. A EUR savings balance displays converted in the display currency and shows the
   native EUR value in the sub-line (existing `showNative` behaviour), and switching
   display currency GBP→EUR→GBP round-trips without the stored balance changing
   (verify via Export data → the holding's `manualValue` is unchanged).
7. "By Account Type" allocation chart shows distinct colours for Cash ISA / Savings.
