# PLAN: ISA Allowance Tracker (rank 4)

## Goal

The app is called "ISA & FIRE" but has no ISA allowance tracking at all. The data model
for it already exists and is 100% dead code today:

- `AppData.taxYear` and `AppData.contributions: TaxYearContribution[]` in [src/types.ts](src/types.ts)
- `currentTaxYear()` and `getCurrentTaxYearContribution()` in [src/store.ts](src/store.ts)
- `taxYearLabel()` in [src/utils.ts](src/utils.ts)

None of these are referenced by any component (verify with grep before starting —
`getCurrentTaxYearContribution` and `taxYearLabel` have zero call sites).

Build the feature: a card on the Portfolio tab showing how much of the current tax
year's £20,000 ISA allowance has been used, with an editor for per-tax-year
contribution amounts.

Also fix a latent bug in `currentTaxYear()`: the UK tax year starts **6 April**, but the
current implementation (`now.getMonth() >= 3`) rolls over on 1 April. Between 1–5 April
the app would report the wrong tax year.

## Files to touch

- [src/store.ts](src/store.ts) — fix `currentTaxYear()`; add `setTaxYearContribution` helper
- [src/utils.ts](src/utils.ts) — add `ISA_ANNUAL_ALLOWANCE = 20000`
- **New:** `src/components/AllowanceCard.tsx`
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — render the card

## Implementation order

### Step 1 — fix the tax-year boundary (`src/store.ts`)

```ts
const currentTaxYear = (): number => {
  const now = new Date();
  const y = now.getFullYear();
  // UK tax year starts 6 April. Jan 1 – Apr 5 belongs to the previous year's tax year.
  return now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6) ? y : y - 1;
};
```

Add a pure helper (testable if PLAN-test-harness is in place):

```ts
export function setTaxYearContribution(data: AppData, taxYear: number, amount: number): AppData {
  const others = data.contributions.filter(c => c.taxYear !== taxYear);
  const contributions = amount > 0
    ? [...others, { taxYear, amount }].sort((a, b) => a.taxYear - b.taxYear)
    : others; // zero/cleared entries are removed, not stored
  return { ...data, contributions };
}
```

### Step 2 — constant (`src/utils.ts`)

```ts
export const ISA_ANNUAL_ALLOWANCE = 20000; // GBP, per person, per tax year (frozen at £20k since 2017/18)
```

### Step 3 — `src/components/AllowanceCard.tsx`

Props: `{ rawData: AppData; onChange: (d: AppData) => void }`. Follow the existing
component conventions exactly — dark slate styling
(`bg-slate-800/70 rounded-xl border border-slate-700/50 p-5`), `Modal` from
`./Modal`, `tabular-nums` on numbers.

Content:
- Header row: "ISA allowance" + tax-year chip using `taxYearLabel(currentTaxYear())`
  (renders e.g. `2026/27`), and a Pencil edit button (lucide `Pencil`, styled like the
  provider edit buttons: `text-slate-600 hover:text-indigo-400`).
- Big number: `formatCurrency(used, 'GBP')` of `ISA_ANNUAL_ALLOWANCE`, e.g.
  "£8,500.00 of £20,000.00 used".
- Progress bar (copy the pattern from ISATracker's Portfolio allocation section:
  outer `h-1.5 bg-slate-700 rounded-full overflow-hidden`, inner width `%`). Bar color:
  indigo (`bg-indigo-500`) normally, `bg-amber-400` at ≥ 90%, `bg-red-500` if over
  100%. Cap the bar **width** at 100% but never the displayed numbers.
- Sub-line: remaining amount (`£11,500.00 remaining`) or, if over,
  `Over allowance by £X` in `text-red-400`.
- Days-remaining hint: days until next 5 April (inclusive), e.g. "271 days left this
  tax year" in `text-xs text-slate-600`.

Edit modal (opens from the Pencil):
- A row per tax year: every year present in `rawData.contributions`, plus the current
  tax year always shown even if absent. Each row: `taxYearLabel(year)` +
  `<input type="number" min="0">` for the amount (GBP).
- An "Add previous year" button that appends a row for the earliest-shown-year − 1.
- Save button applies all rows via repeated `setTaxYearContribution` calls and
  `onChange(result)`; Cancel discards.

### Step 4 — render it (`src/components/ISATracker.tsx`)

Import and place `<AllowanceCard rawData={rawData} onChange={onChange} />` directly
after the summary-cards grid (after the `grid grid-cols-2 lg:grid-cols-4` block, before
the income snapshot). Only render when the user has at least one provider OR at least
one contribution recorded — on a totally empty account the empty state should stay
clean. (`data.providers.length > 0 || data.contributions.length > 0`.)

## Edge cases a weaker model would miss

- **Mutate `rawData`, never `data`.** `data` is the display copy with converted
  currencies and derived fields; every existing mutation path
  (`saveProvider`, `saveHolding`) spreads `rawData`. `onChange({ ...rawData, … })` — copy
  that pattern or the change gets clobbered/corrupted by `applyLivePrices`.
- **Contributions are stored and displayed in GBP, always.** The app has a display
  currency (`useCurrency()`), but the ISA allowance is a GBP-denominated legal limit.
  Do **not** run contribution amounts through the display-currency `fmt` — use
  `formatCurrency(x, 'GBP')` from `src/utils.ts` directly, otherwise switching the
  display currency to USD would show a "£20,000 allowance" as "$20,000". (FIRE settings
  already hardcode `£` the same way.)
- **`contributions` may be `undefined` on old persisted data.** `defaultData` provides
  `[]`, but the load merge in App.tsx spreads `remote` over defaults — if a legacy row
  lacks the key the spread is fine, but guard anyway: read via
  `rawData.contributions ?? []` inside the component. (If
  PLAN-currency-price-integrity landed, `migrateAppData` already guarantees the array.)
- **The allowance is per person, but the data model has no owner.** Providers have
  `owner: 'Daniel' | 'Camilla'`, but `TaxYearContribution` doesn't. Do NOT invent an
  owner field in this pass (it would require a data migration). Single shared tracker;
  label the card "ISA allowance" without a name. If per-owner tracking is wanted later,
  that's a follow-up with a migration.
- **Don't auto-derive contributions from CSV imports.** It's tempting to sum buys from
  the T212 import — wrong: contributions are cash deposited into the ISA wrapper, not
  purchases (you can buy with reinvested dividends or held cash), and GIA/SIPP imports
  don't count at all. Manual entry only.
- **`AppData.taxYear` (the stored field) stays unused.** It's a snapshot of the tax
  year at data creation and nothing maintains it. Always compute via
  `currentTaxYear()`; don't read or update `data.taxYear` (removing the field would
  break old exports — leave it).
- **Number input pitfalls:** `Number('')` is `0` which is fine here (empty = 0 =
  removed on save), but block negatives (`Math.max(0, …)`) and NaN
  (`Number.isFinite(v) ? v : 0`).
- **Days-left math across DST:** compute next 5 April as a `Date` and use
  `Math.ceil((next - now) / 86_400_000)` — off-by-one across DST is acceptable, don't
  over-engineer.
- **`getCurrentTaxYearContribution(data)` already exists in store.ts** — use it for the
  card's headline number instead of re-implementing the find.

## Acceptance criteria

1. `npm run build` and `npm run lint` pass.
2. With today's date (8 July 2026), the card shows tax year **2026/27**
   (`currentTaxYear()` → 2026, `taxYearLabel` → "2026/27").
3. Entering £8,500 for the current year shows "£8,500.00 of £20,000.00", a ~42.5% bar,
   and "£11,500.00 remaining". The value survives a page reload (Supabase round-trip)
   and appears in the JSON export under `contributions`.
4. Entering £21,000 shows a red full-width bar and an "Over allowance by £1,000.00"
   warning; the input is not clamped to 20,000.
5. Adding a previous year (2025/26) with an amount, saving, reopening the modal shows
   both years with their values; clearing a value to 0 and saving removes that entry
   from the exported JSON.
6. Switching display currency to USD changes portfolio values but the allowance card
   still shows £ amounts.
7. Unit check for the boundary fix (add to test suite if PLAN-test-harness landed,
   otherwise verify by temporarily mocking the date): 5 April 2026 → tax year 2025;
   6 April 2026 → tax year 2026.
