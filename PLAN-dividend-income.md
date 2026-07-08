# PLAN: Dividend & Income Tracking from Broker CSVs (rank 4)

## Goal

The CSV importers ([src/lib/csvParsers.ts](src/lib/csvParsers.ts)) read full
transaction histories but keep only buys/sells and throw dividend rows away. Parse
them, persist them per provider, and show an **Income card** on the Portfolio tab:
trailing-12-month income, income per calendar year (bar chart), and portfolio yield on
cost. For FIRE users, "how much does the portfolio already pay me" is a headline
number.

## Files to touch

- [src/types.ts](src/types.ts) — `DividendRecord`, `Provider.dividends`
- [src/store.ts](src/store.ts) — migration default
- [src/lib/csvParsers.ts](src/lib/csvParsers.ts) — parse dividends; **breaking change to `BrokerParser.parse` return type**
- [src/components/CSVImportModal.tsx](src/components/CSVImportModal.tsx) — carry dividends through, show count in preview
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — persist in `handleCSVImport`, render the card
- **New:** `src/components/IncomeCard.tsx`

## Implementation order

### Step 1 — types and migration

```ts
export interface DividendRecord {
  id: string;       // dedupe key — broker tx id if present, else `${date}|${ticker}|${amount}`
  date: string;     // ISO date YYYY-MM-DD
  ticker: string;
  name?: string;
  amount: number;   // net cash received, in `currency`
  currency: string; // ISO 4217
}
// Provider gains:
dividends?: DividendRecord[];
```

In `migrateAppData` (`store.ts`), inside the provider `.map`, add
`dividends: p.dividends ?? []` next to `snapshots: p.snapshots ?? []`.

### Step 2 — extend the parsers

Change the parser contract:

```ts
export interface ParsedImport {
  holdings: ParsedHolding[];
  dividends: DividendRecord[];
}
export interface BrokerParser {
  id: string;
  label: string;
  parse: (csv: string, currency: string) => ParsedImport;
}
```

Update all three parsers to return `{ holdings, dividends }` (Freetrade/HL may return
`dividends: []` initially — see below). TypeScript will then flag the one call site,
`CSVImportModal.handleFile`, which currently does `parser.parse(text, currency)` and
checks `result.length === 0` — change to `result.holdings.length === 0 && result.dividends.length === 0`.

**Trading 212** (the well-specified one — do it properly):

- Dividend rows have `Action` values that all start with `Dividend` — e.g.
  `Dividend (Ordinary)`, `Dividend (Dividend)`, `Dividend (Dividends paid by us corporations)`,
  `Dividend (Property income distribution)`. Match with `/^dividend/i.test(action)`.
- Amount: use the `Total` column and `Currency (Total)` (that's the net cash credited
  to the account, after withholding). Do **not** use `Price / share` for dividends.
- Date: T212 `Time` column is `YYYY-MM-DD HH:MM:SS`; take `.slice(0, 10)` — do not
  `new Date(...)` it (timezone shifts can move a dividend across a year boundary).
- Id: newer T212 exports have an `ID` column; use `col('ID')` and if the index is -1
  or the cell is empty, fall back to `` `${date}|${ticker}|${rawTotal.toFixed(2)}` ``.
- These rows currently fall through the buy/sell `if/else` chain harmlessly — you are
  adding a branch, not changing existing aggregation. Keep the existing
  `if (!ticker || !action) continue;` guard above it.

**Freetrade**: the `Type` column uses values like `DIVIDEND` (the existing parser
lowercases). Add a branch `type === 'dividend'` using `Total Amount` as the amount,
currency: look for an `Account Currency` column via `col(...)`; if absent use `'GBP'`.
Freetrade has no tx id column — synthesize from date|ticker|amount. If a column named
`Timestamp` exists use its first 10 chars, else skip the row (no date ⇒ useless for
income-by-year).

**HL**: HL's transaction export doesn't have a reliable dividend type across account
types; match `type` or description containing `dividend` case-insensitively, else
return no dividends. It must never throw — worst case `dividends: []`.

All three: skip rows with amount ≤ 0 or no parseable date. Never let dividend parsing
failure break holdings parsing — wrap the dividend branch per-row defensively.

### Step 3 — carry through the modal and persist

- `CSVImportModal`: keep `parsed` as `ParsedImport`; preview banner becomes
  "`{holdings.length}` holdings · `{dividends.length}` dividend payments parsed".
  Pass both to `onImport(providerId, parsed, mergeMode)` (change the prop signature).
- `ISATracker.handleCSVImport(providerId, parsed, mergeMode)`:
  - `replace` mode: `dividends: parsed.dividends` (full replace, mirroring holdings).
  - `merge` mode: union by `id`:
    ```ts
    const seen = new Set((p.dividends ?? []).map(d => d.id));
    const dividends = [...(p.dividends ?? []), ...parsed.dividends.filter(d => !seen.has(d.id))];
    ```
  - Sort by date ascending before storing (stable chart order).
  - Everything else in `handleCSVImport` stays as-is (it already spreads `rawData` —
    keep that; never build the next state from `data`).

Persistence is free: `Provider` serialises into the `user_data.data` JSONB blob;
`stripDerived` only touches holdings, so `dividends` survive `saveToSupabase` and
`exportData` untouched.

### Step 4 — IncomeCard

New `src/components/IncomeCard.tsx`, props
`{ data: AppData; fxRates: FxRates }` — mount in `ISATracker.tsx` after the
income-snapshot grid (the "SWR / 8% return" cards), gated on
`data.providers.some(p => (p.dividends?.length ?? 0) > 0)`.

- Convert every record with
  `convertAmount(d.amount, d.currency, userCurrency, fxRates)` (get `userCurrency`
  from `useCurrency()`); today's FX rate applied to historic dividends is an accepted
  approximation — add a footnote "converted at current FX rates".
- Headline: TTM income = sum of records with `date >= (today − 365d)` (compare as ISO
  strings: compute the cutoff with `new Date(Date.now() - 365*864e5).toISOString().slice(0,10)`
  then plain string `>=` — dates are ISO so lexicographic order is correct).
- Sub-stat: yield on cost = TTM / `totalCostBasis` (reuse the same reduce as the
  summary cards — over `data`, i.e. display-converted cost) — guard `totalCostBasis > 0`.
- Bar chart: income per calendar year (`d.date.slice(0, 4)`), recharts `BarChart`,
  copy the dark tooltip style from `AllocationCharts.tsx`'s `CustomTooltip`.
- Expandable "by holding" list: top payers by TTM amount, `fmt` values.

## Edge cases a weaker model would miss

- **Re-import double counting**: users re-export their full T212 history every few
  months and re-import in merge mode. Without the `id` dedupe union in step 3,
  income doubles. This is the single most important behaviour in the plan — the
  existing holdings merge already has this flaw (it re-adds units), which is why the
  UI copy for merge mode warns about summing; dividends must NOT inherit it.
- **Replace mode wipes history**: replacing from a CSV covering only the last year
  deletes older dividend records. Mirror-of-holdings semantics is still the right
  call (predictable), but add one sentence to the existing merge-mode explainer text
  in `CSVImportModal`: "Replace also replaces dividend history with what's in this
  file."
- **`Currency (Total)` ≠ instrument currency**: a USD stock in a GBP T212 account pays
  a dividend whose `Total` is in GBP. Trust the currency column, never the holding's
  currency.
- **Withholding tax**: T212 `Total` for US dividends is already net of the 15%
  withholding. Don't add the `Withholding tax` column back; label the card "net
  income" somewhere subtle.
- **Date parsing**: `new Date('2024-04-05 21:30:00')` is implementation-defined /
  timezone-shifted; string slicing is deliberate (see step 2).
- **Old data**: providers created before this feature have `dividends === undefined` —
  hence `?.` everywhere and the `migrateAppData` default; also `exportData` JSON from
  before the feature must import cleanly (it will, via the same default).
- **Parser return-type change is breaking**: if you update `BrokerParser` but miss the
  `result.length === 0` check in `CSVImportModal`, imports break for everyone —
  `tsc` catches it only because the plan changes the type rather than adding an
  optional second array. That's intentional; don't "avoid churn" with an optional
  field.
- **`fmt` of tiny amounts**: dividends are often £0.43; `formatCurrency` keeps 2 dp so
  fine — but `fmtShort` collapses ≥£1,000 only; use `fmt` in the by-holding list.

## Acceptance criteria

1. `npm run build` passes.
2. Importing a T212 CSV containing `Dividend (Ordinary)` rows shows
   "N holdings · M dividend payments parsed" in the preview and, after import, an
   Income card with a non-zero TTM figure.
3. Re-importing the exact same CSV in **merge** mode leaves TTM income unchanged
   (dedupe proof). Importing it in **replace** mode also leaves it unchanged
   (full replace with identical set).
4. A dividend paid in USD on a GBP display shows converted at the current FX rate;
   switching display currency changes the displayed number but exporting data shows
   the original USD `amount` unchanged.
5. Income-per-year bars match a hand-computed sum for one year of the test CSV.
6. Freetrade and HL CSVs without recognisable dividend rows import exactly as before
   (holdings unchanged, no card shown, no errors).
7. Pre-feature JSON exports import without errors; providers show no Income card until
   a CSV with dividends is imported.
