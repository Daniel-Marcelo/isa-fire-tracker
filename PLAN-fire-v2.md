# PLAN: FIRE Tab v2 — Confidence-Based Retirement Age

## Goal

Make the Monte Carlo engine *the* engine, instead of a sidecar commentary on a
different rule. Today the FIRE age comes from a pot-target rule (combined ≥
spending ÷ SWR) and the Monte Carlo card then reports the success odds of that same
age — two adequacy definitions that disagree, producing an uneasy "you can retire at
47.2 (74% chance it works)". Invert it:

1. **Mode "Earliest age"** (default): user sets a target confidence (default 90%);
   the calculator solves for the earliest retirement age whose Monte Carlo success
   rate meets it. Headline: "Age 48.5 — earliest retirement with ≥90% confidence".
2. **Mode "Chosen age"**: user pins a retirement age; the calculator reports the
   confidence. (This resurrects the currently-dead `targetRetirementAge` field.)
3. **Confidence-vs-age curve**: a chart of success probability against retirement
   age, so the whole trade-off is visible at once.
4. **State pension**: toggle + annual amount + start age; from that age the pots fund
   only the remainder of spending. Default ON at £12,000 from 67.
5. **Pension drawdown tax**: a single effective-rate input (default 15%) that
   grosses up withdrawals from the pension pot (ISA withdrawals stay tax-free).
6. **Plan-to age** input (replaces the hardcoded 95).
7. **Sensitivity chips**: "retire 1 year later → 94% · spend £2,000/yr less → 95%".
8. Remove the dead `currentSavings` field.

Deferred to a later plan (do NOT attempt here): one-off events, spending phases,
contribution growth, spending guardrails, two-person household mode, historical
bootstrap returns.

## Files to touch

- [src/types.ts](src/types.ts) — new `FireSettings` fields; delete `currentSavings`
- [src/store.ts](src/store.ts) — new defaults; delete `currentSavings` default
- **New:** `src/lib/fireEngine.ts` — shared per-month withdrawal rules
- [src/lib/monteCarlo.ts](src/lib/monteCarlo.ts) — use the shared rules; add `solveEarliestFireAge` + `successCurve`
- [src/lib/fireProjection.ts](src/lib/fireProjection.ts) — use the shared rules; survival-based deterministic FIRE age; horizon from `planToAge`
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — mode toggle, new inputs, hero card, curve chart, sensitivity chips
- Tests: `src/lib/fireEngine.test.ts` (new), plus **expectation updates** in
  `fireProjection.test.ts`, `monteCarlo.test.ts`, and `currentSavings` removal from
  the fixtures in `applyLivePrices.test.ts`, `snapshots.test.ts`,
  `fireProjection.test.ts`, `monteCarlo.test.ts`.

## Implementation order

### Step 1 — settings

In `types.ts`, `FireSettings` gains (all optional — the codebase pattern; defaults
live in `defaultFireSettings` and `migrateAppData`'s spread applies them to old data):

```ts
fireMode?: 'earliest' | 'fixedAge';   // default 'earliest'
targetConfidence?: number;            // %, default 90, clamp 50–99 at use sites
planToAge?: number;                   // default 95, clamp 80–105
statePensionEnabled?: boolean;        // default true
statePensionAnnual?: number;          // £/yr today's money, default 12000
statePensionAge?: number;             // default 67
pensionTaxRate?: number;              // %, default 15, clamp 0–60
```

Delete `currentSavings` from the interface and from `defaultFireSettings` (it has
never been read anywhere — verify with grep). TypeScript will then flag the four test
fixtures listed above; remove the property from each. Keep `targetRetirementAge`
(becomes the mode-2 input) and keep `withdrawalRate` — **it is still read by the
Portfolio tab's SWR card** (`ISATracker.tsx`, `data.fireSettings?.withdrawalRate`),
so it must survive even though it no longer determines the FIRE age.

### Step 2 — shared withdrawal rules (`src/lib/fireEngine.ts`)

The deterministic projection and the Monte Carlo currently mirror each other's
drawdown logic by hand; v2 adds state pension + tax to both, which doubles the drift
risk. Extract the one thing they must agree on:

```ts
export interface DrawdownParams {
  pensionAccessAge: number;
  monthlySpend: number;          // net need, today's money
  statePensionMonthly: number;   // 0 when disabled
  statePensionAge: number;
  pensionTaxRate: number;        // fraction 0..0.6
}

/** Pot outflows for one retired month. Positive numbers; caller subtracts. */
export function monthlyWithdrawals(
  age: number, accessible: number, pension: number, p: DrawdownParams,
): { fromAccessible: number; fromPension: number } {
  const sp = age >= p.statePensionAge ? p.statePensionMonthly : 0;
  const need = Math.max(0, p.monthlySpend - sp);   // state pension covers the rest
  if (age < p.pensionAccessAge) {
    return { fromAccessible: need, fromPension: 0 }; // the bridge
  }
  const total = Math.max(accessible + pension, 0);
  const accRatio = total > 0 ? Math.max(accessible, 0) / total : 0;
  const fromAccessible = need * accRatio;
  // Pension withdrawals are grossed up so the *net* need is met after tax.
  const fromPension = (need * (1 - accRatio)) / (1 - p.pensionTaxRate);
  return { fromAccessible, fromPension };
}
```

Both simulators call this every retired month and apply growth themselves. The
state-pension amount is treated as net of tax (the input hint says so) — do not also
tax it.

### Step 3 — engine functions

In `monteCarlo.ts`:

- `runMonteCarlo` gains the drawdown params (derive them once from `FireSettings`
  via a small `drawdownParamsFrom(settings)` helper in `fireEngine.ts`) and takes
  `endAge` from `planToAge`. Failure rules unchanged: accessible exhausted during
  the bridge, or combined exhausted before `endAge`.
- **`solveEarliestFireAge(settings, acc, pen, opts): number | null`** — binary
  search over retirement age in months within `[currentAge, planToAge − 1]`.
  Success probability is non-decreasing in retirement age (longer accumulation,
  shorter drawdown), so binary search is valid — but evaluate the upper bound
  first and return `null` if even that misses the target, and return `currentAge`
  if the lower bound already meets it. ~10 evaluations × 1,000 runs is fine.
  **Every evaluation must use the same seed** so the search is deterministic.
- **`successCurve(settings, acc, pen): { age: number; pct: number }[]`** — success
  rate at yearly retirement ages from `ceil(currentAge)` upward; stop after the rate
  exceeds 99% twice in a row or after 30 points. Use `runs: 400` here (chart
  resolution doesn't need 1,000) but the same fixed seed.

In `fireProjection.ts`:

- Horizon: replace both hardcoded `m <= 600` loops with
  `months = Math.min(Math.max(Math.round((planToAge - currentAge) * 12), 12), 900)`.
- Redefine the deterministic FIRE age as **survival-based**: earliest age (same
  yearly check cadence as now) from which the deterministic simulation — using
  `monthlyWithdrawals` — keeps the bridge solvent and the combined pot ≥ 0 through
  `planToAge`. Delete the `pensionTarget = annualExpenses / swr` criterion. Keep
  `earlyFireAge`/`fullFireAge` return shape so `project()` and the chart labels
  keep working, where `fullFireAge` now means "survives when retiring at/after
  pension access".
- `project()`'s drawdown branch also switches to `monthlyWithdrawals`.

### Step 4 — FIRECalculator UI

- **Mode toggle** next to the hero (reuse the `split`/`combined` segmented-control
  styling): "Earliest age" / "Chosen age". Persist via `update({ fireMode })`.
- **Hero card** (replaces the current FIRE-age block inside the Spending card):
  - `earliest`: solved age as "Age 48.5", subtitle "earliest retirement with
    ≥90% confidence · smooth-market estimate: 47.2". If `solveEarliestFireAge`
    returns null: "—" + "Not reachable by {planToAge} at {confidence}% — lower the
    confidence target, spending, or check contributions."
  - `fixedAge`: a NumberInput bound to `targetRetirementAge` (min `currentAge`,
    max `planToAge`) and the big number is the confidence % at that age,
    colour-coded like the existing Market-risk number.
- **Confidence curve card**: recharts `LineChart` over `successCurve` data;
  Y-domain 0–100; `ReferenceLine y={targetConfidence}` (dashed) and
  `ReferenceLine x={solved or chosen age}`; tooltip "Retire at 48 → 91%".
- **Sensitivity chips** under the hero: run the MC twice more at the
  solved/chosen age — once with retirement age +1 year, once with
  `annualExpensesInRetirement − 2000` — and render
  "Retire 1 yr later → 94%" / "Spend £2k/yr less → 95%". **Same seed as the main
  run** (common random numbers), otherwise the deltas are seed noise.
- **New inputs.** Assumptions grid gains: "Target confidence (%)" (only meaningful
  in earliest mode but always visible), "Plan to age". New "State pension" row group:
  toggle, "Amount (£/yr, today's money)", "From age", with hint:
  *"Paid worldwide based on your NI record — check gov.uk for your forecast. Enter
  your accrued amount to be conservative, or £0 to ignore it."* Advanced-feeling
  input "Pension drawdown tax (%)" with hint *"Effective rate on pension
  withdrawals; ISA withdrawals are tax-free."* Change the SWR input's hint to
  *"Used for the Portfolio tab's SWR card — FIRE age is confidence-based now."*
- **Market-risk card**: keep, but it now shows the bands for the solved/chosen
  retirement age and its subtitle mentions `planToAge` instead of 95.
- Charts: add a `ReferenceLine` at `statePensionAge` (subtle, e.g. teal dashed)
  when the state pension is enabled. The year-by-year "Withdrawn/yr" column should
  show the actual pot outflow for that year (post-state-pension, tax-grossed), not
  the flat `annualExpensesInRetirement`.

### Step 5 — tests

New `fireEngine.test.ts`:
- Bridge month: everything from accessible, nothing from pension, even at 99% tax.
- Post-access, tax 20%, need £1,000 entirely from pension → gross £1,250.
- State pension ≥ spending → both withdrawals 0.
- State pension only applies from `statePensionAge`.

`monteCarlo.test.ts` additions:
- σ=0: `solveEarliestFireAge` equals the deterministic survival age within 1 month.
- Raising `targetConfidence` never lowers the solved age; enabling the state
  pension never raises it; shorter `planToAge` never raises it.
- Absurd wealth → solves to `currentAge`; absurd spending → `null`.
- Same seed ⇒ identical solved age and curve.

`fireProjection.test.ts`: **rewrite the adequacy expectations** — the existing tests
assert the SWR pot-target (`swrTarget` variable); they must now assert survival
semantics (e.g. at the returned FIRE age, simulating forward leaves combined ≥ 0
through `planToAge`, and one year earlier does not).

## Edge cases a weaker model would miss

- **`withdrawalRate` is load-bearing elsewhere.** Deleting it breaks the Portfolio
  tab's SWR card. Keep the field and the input; only its role in FIRE age dies.
- **Common random numbers.** The sensitivity chips and the binary search compare MC
  results against each other. With different seeds, a ±2pp difference is noise and
  the chips will show nonsense like "spend less → 89% (down from 90%)". One shared
  constant seed everywhere.
- **Binary-search bounds.** Check `upper` first (else `null`), then `lower` (else
  search). If `planToAge <= currentAge + 1`, skip solving entirely and render the
  degenerate-horizon copy — `runMonteCarlo` already returns
  `{ successRate: 1, bands: [] }` for horizons under 12 months; don't "fix" that.
- **`NumberInput` emits `Number('') === 0`.** Clamp `targetConfidence` into
  [50, 99], `planToAge` into [80, 105], `pensionTaxRate` into [0, 0.6] *inside the
  engine helpers*, not just in the input `min`/`max` attributes (typing then
  clearing a field passes 0 through).
- **Tax gross-up divides by `(1 − rate)`** — the clamp above is what prevents a
  divide-by-zero at a typed rate of 100.
- **State pension is netted before the split.** Applying the `accRatio` split to
  the full spend and *then* subtracting the state pension from one pot's share is
  wrong; the shared `monthlyWithdrawals` shape prevents this — don't inline it.
- **`targetRetirementAge` has stale persisted values** (default 55 from v1 data).
  Clamp to `[currentAge, planToAge]` when reading it in mode 2, or a user aged 60
  sees a planned age in the past and a nonsense confidence.
- **Old exports/rows** get every new field from `migrateAppData`'s
  `{ ...defaults, ...parsed.fireSettings }` spread — but only because the defaults
  live in `defaultFireSettings`. Do not default inline in the component only.
- **Removing `currentSavings`** breaks four test fixtures via excess-property
  checks — that is the intended tripwire; fix the fixtures, don't re-add the field.
- **Horizon cap at 900 months** keeps a `currentAge: 18, planToAge: 105` input from
  ballooning the year-by-year table and MC cost; state the cap in the planToAge hint.
- The deterministic FIRE age becoming survival-based will generally be **later**
  than the old SWR-based age for SWR ≥ 4 and **earlier** for very low SWRs with a
  long horizon — this is expected, not a regression; the acceptance criteria pin
  the new semantics.

## Acceptance criteria

1. `npm run build` and `npx vitest run` pass; no remaining reference to
   `currentSavings` anywhere in `src/`.
2. Default state (90% confidence, state pension on): the hero shows a solved
   "earliest age", and the Market-risk card at that age shows ≥ 90%.
3. Switching to "Chosen age" mode with age 50 shows a confidence %; raising the
   chosen age raises (or holds) the confidence, never lowers it.
4. Toggling the state pension **off** moves the solved earliest age later (or holds
   it); setting the amount to 0 with the toggle on gives the same result as off.
5. Setting pension tax to 0 vs 15%: the solved age with tax is ≥ the age without.
6. Plan-to age 85 solves earlier than (or equal to) plan-to 100, all else equal.
7. The confidence curve renders, crosses the dashed target-confidence line at the
   solved age (±1 year), and the sensitivity chips show values within a few points
   of the headline that move in the correct directions.
8. σ=0 sanity: with volatility 0, the confidence shows 100% at any age ≥ the
   deterministic FIRE age and 0% just below the bridge-feasible age.
9. A v1 JSON export imports cleanly: FIRE tab renders with defaults for every new
   field and the old `targetRetirementAge`/`withdrawalRate` values preserved.
10. Portfolio tab's SWR card still reflects the `withdrawalRate` input.
