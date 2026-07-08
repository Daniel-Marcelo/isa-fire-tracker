# PLAN: Target Allocation & Rebalancing Helper (rank 3)

## Goal

Users hold the same funds across several providers (T212 ISA, Vanguard SIPP, …) but
have no way to say "I want 60% VWRP / 20% VFEG / 10% BRK.B / 10% cash" and see drift.
Add a **portfolio-level target allocation** with:

- an editable target % per position (aggregated across providers by ticker),
- current % vs target % with drift, and
- a **"new money" calculator**: enter a contribution amount and get a buy-only
  allocation that moves the portfolio toward target without selling (the normal way
  ISA investors rebalance).

## Files to touch

- [src/types.ts](src/types.ts) — `AllocationTarget`, `AppData.targets`
- [src/store.ts](src/store.ts) — default + migration for `targets`
- **New:** `src/lib/rebalance.ts` — pure aggregation + buy-only allocation math
- **New:** `src/components/RebalanceCard.tsx`
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — render the card

## Implementation order

### Step 1 — data model

`types.ts`:

```ts
export interface AllocationTarget {
  key: string;       // uppercase ticker, or exact holding name for ticker-less positions
  targetPct: number; // 0..100
}
// AppData gains:
targets: AllocationTarget[];
```

`store.ts`: add `targets: [],` to `defaultData` **and** `targets: parsed.targets ?? []`
inside `migrateAppData` (next to the existing `contributions: parsed.contributions ?? []`
line). Without the migration line, every old Supabase row and old JSON export loads
with `targets === undefined` and the first `.map` on it crashes the app at startup.

### Step 2 — pure math module `src/lib/rebalance.ts`

```ts
import type { AppData, Holding } from '../types';

export interface Position {
  key: string;        // uppercase ticker ?? name
  label: string;      // display name (first holding's name encountered)
  value: number;      // display-currency current value, summed across providers
}

export function positionKey(h: Pick<Holding, 'ticker' | 'name'>): string {
  return (h.ticker?.trim() ? h.ticker.trim().toUpperCase() : h.name.trim());
}

/** Aggregate the *display* data's holdings across all providers. */
export function aggregatePositions(data: AppData): Position[]
```

Implementation: reduce over `data.providers.flatMap(p => p.holdings)`, group by
`positionKey`, sum `h.currentValue ?? 0`, sort by value desc.

Buy-only allocator:

```ts
export interface BuyPlanRow { key: string; buy: number }

export function planNewMoney(
  positions: Position[],
  targets: { key: string; targetPct: number }[],
  contribution: number,
): BuyPlanRow[]
```

Algorithm (state it exactly so it's implemented deterministically):

1. `T = sum(position values covered by targets) + contribution` — note: **only**
   positions with a target participate; untargeted positions are ignored entirely.
2. Normalise targets to fractions of their own sum (so targets of 50/30/20 and
   25/15/10 behave identically): `frac_i = targetPct_i / sum(targetPct)`.
3. `deficit_i = max(0, frac_i * T − currentValue_i)` (missing positions count as
   currentValue 0).
4. If `sum(deficit) >= contribution`: `buy_i = contribution * deficit_i / sum(deficit)`.
5. Else: fill all deficits, then spread the remainder by `frac_i`:
   `buy_i = deficit_i + (contribution − sum(deficit)) * frac_i`.
6. Round each `buy_i` to 2 dp and push any rounding residue into the largest row so
   the buys sum exactly to the contribution.
7. `contribution <= 0` or empty targets ⇒ return `[]`.

### Step 3 — RebalanceCard component

New `src/components/RebalanceCard.tsx`, props:
`{ data: AppData; rawData: AppData; onChange: (d: AppData) => void }`.

Layout (follow the app's dark idiom — copy classes from the "Portfolio allocation"
card in `ISATracker.tsx`: `bg-slate-800/70 rounded-xl border border-slate-700/50 p-5`):

- Collapsible header "Target allocation" (copy the chevron pattern from
  `AllocationCharts.tsx`). Collapsed by default when `targets.length === 0`? No —
  when there are no targets show a one-line empty state with a "Set targets" button
  that expands the editor.
- Table rows = union of `aggregatePositions(data)` and `data.targets` keys:
  - Position label + key, current value (`fmt`), current % of the **targeted-total**
    (see edge cases), editable target % (`<input type="number">`, styled like
    `NumberInput` in FIRECalculator), drift in percentage points coloured
    green within ±1pp / amber ±5pp / red beyond.
  - A target with no matching position renders with value £0 and a subtle
    "not held" note; a position with no target shows "—" in the target column.
- Footer row: sum of targets. If ≠ 100 (tolerance 0.01), show an amber note
  "Targets sum to X% — treated as weights" (the math in step 2 normalises, so this is
  informational, not an error).
- **New money panel**: an amount input + the resulting buy list
  (`planNewMoney(...)`), each row "Buy £X of VWRP", with a copy-friendly total line.
  This is derived UI state only — do not persist the contribution amount.

Saving targets — this is where the `data`/`rawData` split bites:

```ts
function saveTargets(next: AllocationTarget[]) {
  onChange({ ...rawData, targets: next });
}
```

**Never** `{ ...data, targets }` — `data` is the display copy with converted
`costBasis` and derived fields; writing it back through `handleChange` corrupts
`baseData.current` (see PLAN-fire-monte-carlo.md step 1 for the same bug class).
Read values/percentages from `data`; write through `rawData`.

Debounce or commit-on-blur the target inputs (a save fires a Supabase upsert after 1s
via `scheduleSave`; per-keystroke onChange is fine functionally but blur-commit keeps
history sane).

### Step 4 — mount it

In `ISATracker.tsx`, render `<RebalanceCard data={data} rawData={rawData} onChange={onChange} />`
after the `AllocationCharts` block (~line 270). Gate on `totalValue > 0`.

### Step 5 — tests (if Vitest is set up)

`src/lib/rebalance.test.ts`:
- Aggregation merges same ticker across two providers and uses ticker over name.
- `planNewMoney`: contribution smaller than total deficit splits proportionally to
  deficits; larger than deficit fills then splits by weight; sums exactly to the
  contribution after rounding; empty targets ⇒ `[]`.
- Targets summing to 50 behave identically to the same ratios summing to 100.

## Edge cases a weaker model would miss

- **Percentage denominator**: current % must be computed against the sum of
  *targeted* positions (+ nothing else), not the whole portfolio — otherwise a user
  who targets only their equity funds can never reach the targets because pensions/
  untargeted positions dilute the denominator. Show a footnote with how much of the
  portfolio is untargeted (`fmt(totalValue − targetedValue)`).
- **Aggregation across owner/type filters**: the card must use the full `data`, not
  `visibleProviders` — the Portfolio page filters (Owner/Type chips) are view state
  and would silently change the math.
- **Same fund, different key**: a CSV-imported holding has `ticker: 'VWRP'` while a
  manually added one might be ticker-less with name "Vanguard FTSE All-World" —
  they aggregate as *two* positions. Don't try to fuzzy-merge; surface both rows (the
  user can edit the manual holding to add the ticker). Note this in the card footnote
  only if trivial, otherwise skip.
- **Holdings with no live price**: `currentValue` for a ticker holding without a
  fetched price falls back to converted `manualValue` (see `applyLivePrices`), which
  after a CSV import equals **cost basis** until PLAN-snapshot-accuracy/price fixes
  land. The card still works; just don't assume `currentValue > 0` (a brand-new
  imported holding can be 0 before the first price refresh — guard divisions:
  `pct = total > 0 ? value / total : 0`).
- **Ticker-less keys are names** and names contain spaces/commas — never split or
  parse keys; treat them as opaque strings. Uppercase only tickers, not names
  (two distinct manual holdings "Gold" and "GOLD" staying distinct is fine).
- **Deleting a holding leaves an orphan target** — that's by design (render "not
  held"), but provide a small ✕ per row to delete a target, or stale targets
  accumulate forever.
- **`migrateAppData` default** (step 1) — the classic crash-on-old-data mistake.
- **Rounding residue** in `planNewMoney` (step 2.6) — without it the buys sum to
  £999.99 and users notice.

## Acceptance criteria

1. `npm run build` passes.
2. With VWRP held in two providers (e.g. £6,000 + £2,000) and a target of
   VWRP 80 / VFEG 20 (VFEG £1,000 held): the card shows VWRP as one row, current
   £8,000, current 88.9%, drift +8.9pp.
3. New money £1,000 against that state allocates £0 (VWRP over target) … actually:
   deficits are VFEG `0.2*10000−1000=1000`, VWRP `0.8*10000−8000=0` ⇒ the full £1,000
   goes to VFEG. Verify exactly that.
4. New money £5,000 on the same state: T=14,000; deficits VFEG £1,800, VWRP £3,200;
   both filled exactly (sum £5,000) — verify the rows read Buy VFEG £1,800 /
   Buy VWRP £3,200.
5. Targets summing to 40 (e.g. 32/8) produce identical buy plans to 80/20.
6. Setting targets, reloading the page, and re-importing an old (pre-feature) JSON
   export all work without crashes; the old export simply has no targets.
7. Editing a target never changes any holding's `costBasis`/`manualValue` in an
   exported JSON (proves the `rawData` write path).
