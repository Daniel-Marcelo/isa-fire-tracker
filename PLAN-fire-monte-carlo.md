# PLAN: Monte Carlo FIRE Simulation (rank 2)

## Goal

The FIRE page gives a single deterministic answer ("FIRE age 47.3") from a fixed real
return. That hides sequence-of-returns risk — the main thing that makes early
retirement fail. Add a Monte Carlo card to the FIRE page:

- a **success probability** ("87% of 1,000 simulated market histories never ran out of
  money before age 95"),
- a **percentile band chart** (10th / 50th / 90th percentile combined wealth by age),
- one new assumption input: **annual return volatility (%)**, default 15.

All math goes in a new pure module `src/lib/monteCarlo.ts` so it is unit-testable
(PLAN-test-harness.md sets up Vitest; if it has landed, add tests, otherwise leave a
TODO block as described in step 6).

**This plan also fixes a live data-corruption bug it would otherwise sit on top of**
(step 1) — read that step first.

## Files to touch

- [src/App.tsx](src/App.tsx) — pass `rawData` to `FIRECalculator` (bug fix)
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — bug fix + new card + volatility input
- **New:** `src/lib/monteCarlo.ts`
- [src/types.ts](src/types.ts) — `FireSettings.returnVolatility`
- [src/store.ts](src/store.ts) — default for `returnVolatility`

## Implementation order

### Step 1 — fix the `update()` corruption bug (do not skip)

`FIRECalculator` receives only the **display** data (`data`), whose holdings carry
runtime fields and a `costBasis` already converted into the display currency (see
`applyLivePrices` in `App.tsx`). Its `update()` does:

```ts
onChange({ ...data, fireSettings: { ...s, ...patch } });
```

`handleChange` in `App.tsx` then sets `baseData.current = next`. So **changing any FIRE
input overwrites the canonical native-currency state with the display-converted copy**.
If the display currency differs from a holding's native currency, that holding's
`costBasis` is silently re-based (and re-converted again on the next render — the same
class of bug as commit `4c223f8`). `saveToSupabase`/`exportData` strip
`currentPrice`/`currentValue` but **not** the converted `costBasis`, so the corruption
persists to the database one second later.

Fix exactly as `ISATracker` already does it:

1. In `App.tsx` route: `<FIRECalculator data={data} rawData={baseData.current} onChange={handleChange} />`
2. In `FIRECalculator.tsx`: add `rawData: AppData` to `Props`; change `update` to
   `onChange({ ...rawData, fireSettings: { ...rawData.fireSettings, ...patch } })`.
   Keep **reading** pot values from `data` (they must stay display-converted).

### Step 2 — the pure simulation module

Create `src/lib/monteCarlo.ts`:

```ts
import type { FireSettings } from '../types';

export interface MonteCarloResult {
  successRate: number;              // 0..1
  bands: { age: number; p10: number; p50: number; p90: number }[]; // combined wealth
  runs: number;
}

// Deterministic PRNG so results are stable across renders and testable.
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Main entry:

```ts
export function runMonteCarlo(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
  retireAge: number,        // deterministic FIRE age from the existing model
  opts = { runs: 1000, endAge: 95, seed: 12345 },
): MonteCarloResult
```

Return model — monthly lognormal **real** returns:

- `realAnnual = (1 + expectedAnnualReturn/100) / (1 + inflationRate/100) - 1`
  (same formula as `realMonthlyRate` in FIRECalculator — keep them consistent).
- `sigmaM = (returnVolatility / 100) / Math.sqrt(12)`
- `muM = Math.log(1 + realAnnual) / 12 - sigmaM * sigmaM / 2`
- Each month draw `z` standard normal (Box–Muller from two `rng()` uniforms; guard
  `u1 = Math.max(rng(), 1e-12)` against `log(0)`), monthly growth factor
  `= Math.exp(muM + sigmaM * z)`. If `returnVolatility === 0`, use the deterministic
  factor `Math.exp(muM')` where `muM' = Math.log(1 + realAnnual) / 12` (no `-σ²/2`
  correction — otherwise σ=0 gives a biased-down drift and won't match the
  deterministic projection).

Per-path rules — mirror `project()` in FIRECalculator so the two models agree in the
zero-vol limit:

- Before `retireAge`: both pots grow by the factor, then add `monthlyContribution` /
  `monthlyPensionContribution ?? 0`.
- After `retireAge`, before `pensionAccessAge`: accessible grows then pays
  `annualExpensesInRetirement / 12`; pension only grows. If accessible drops below 0
  before pension access, the path is a **failure** (record it, stop simulating that
  path or floor at 0 and mark failed — recording matters, not the continuation).
- From `pensionAccessAge`: proportional drawdown exactly like `project()` (spend split
  by `accRatio = max(accessible,0) / total`). Path fails if `accessible + pension < 0`
  before `endAge`.
- `successRate = surviving / runs`.

Bands: sample combined wealth (`max(acc,0) + max(pen,0)`) every 12th month into a
per-age array across runs; after all runs, sort each age's samples and take indexes
`floor(0.10*runs)`, `floor(0.50*runs)`, `floor(0.90*runs)`.

### Step 3 — types & defaults

`types.ts`: add `returnVolatility: number;` to `FireSettings`.
`store.ts`: add `returnVolatility: 15,` to `defaultFireSettings`.

No migration code needed beyond that: `migrateAppData` already does
`fireSettings: { ...defaultData.fireSettings, ...parsed.fireSettings }`, so old
Supabase rows and old JSON exports pick up the default automatically. (This is why the
default **must** live in `defaultFireSettings` and not inline in the component.)

### Step 4 — wire into FIRECalculator

- Add a `NumberInput` "Return volatility (%/yr)" (min 0, max 50, step 1) in the
  Assumptions grid, hint: "S&P-like ≈ 15–18, 60/40 ≈ 10, cash ≈ 1".
- Compute below the existing `result` memo:

```ts
const retireAge = result.earlyFireAge ?? result.fullFireAge;
const mc = useMemo(
  () => retireAge != null ? runMonteCarlo(s, accessibleValue, pensionValue, retireAge) : null,
  [s, accessibleValue, pensionValue, retireAge],
);
```

- New card after the "Spending + FIRE date" card. Contents:
  - Big number: `{(mc.successRate * 100).toFixed(0)}%` coloured
    `>= 90` green-400, `>= 75` amber-400, else red-400, label
    "chance your money lasts to 95 · {mc.runs} simulations".
  - If `retireAge == null`: render the card with an em dash and the existing
    "Increase contributions or reduce spending" hint instead of crashing.
  - Band chart: `ResponsiveContainer` + `ComposedChart` (or `AreaChart`) over
    `mc.bands`, `XAxis dataKey="age"`, `YAxis tickFormatter={fmtShort}`; render `p90`
    as a thin line, `p50` as a bold line, `p10` as a thin line (three `Line`s is the
    simplest correct rendering — a true shaded band needs a stacked-area trick
    `[p10, p90-p10]`; do that only if it's quick). Reuse `CHART_TOOLTIP_STYLE`.

### Step 5 — performance sanity

1,000 runs × ~780 months (age 30 → 95) ≈ 0.8M loop iterations of cheap arithmetic —
fine synchronously inside `useMemo` (tens of ms). Do **not** re-run on every keystroke
render outside the memo, and keep `seed` constant so the number doesn't flicker between
identical inputs. Only bump `runs` if it stays under ~100ms.

### Step 6 — tests (if Vitest is set up)

`src/lib/monteCarlo.test.ts`:
- σ=0 ⇒ `successRate` is exactly 0 or 1, and `p10 === p50 === p90` at every age.
- σ=0 with generous contributions ⇒ success 1; with `annualExpensesInRetirement`
  absurdly high vs pots ⇒ success 0.
- Same seed twice ⇒ identical results; different seeds ⇒ successRate within a few
  points (sanity, not exact).
- `mulberry32(1)` first three outputs snapshot (regression pin).

If Vitest is absent, add `// TODO(test-harness): cover σ=0 parity + seed determinism`
at the top of `monteCarlo.ts` and move on.

## Edge cases a weaker model would miss

- **The step-1 bug**: adding the card without fixing `update()` means every volatility
  tweak corrupts persisted cost bases when display currency ≠ holding currency.
- **σ=0 drift bias**: applying the `-σ²/2` lognormal correction at σ=0 is harmless,
  but using `muM = ln(1+r)/12 - σ²/2` with σ>0 and then comparing the median to the
  deterministic chart: the *median* path grows at `ln(1+r)/12 - σ²/2` — it is
  *supposed* to sit below the deterministic line. Don't "fix" that; it's the point.
- **`retireAge` can be null** (`findFireAges` finds nothing within 600 months) — guard
  before simulating.
- **Box–Muller domain**: `Math.log(rng())` NaNs when the PRNG returns exactly 0.
- **`currentAge >= endAge`** (user types 96 into age): months loop count
  `(endAge - currentAge) * 12` goes ≤ 0 — clamp to ≥ 12 or return
  `successRate: 1, bands: []` early; the chart must tolerate an empty `bands` array.
- **`NumberInput` emits 0 for cleared fields** (`Number('') === 0`), so volatility 0
  must be a fully working input, not a crash — hence the explicit σ=0 branch.
- **Percentile indexing**: with `runs = 1000`, `floor(0.9*1000) = 900` on a 0-indexed
  sorted array of length 1000 is valid; don't use `Math.round` (1000 would overflow at
  p100-style edges if anyone changes constants).
- **Pension can go negative** in the proportional-drawdown phase just like `project()`
  lets it; failure is judged on the combined total, matching the deterministic model's
  semantics (`fullFireAge` uses `max(accessible,0) + pension`).

## Acceptance criteria

1. `npm run build` passes.
2. **Bug-fix proof**: set display currency to USD with a GBP holding that has a cost
   basis; change "Return volatility" (or any FIRE input) twice; export data — the
   holding's `costBasis` in the JSON equals the original GBP number (before this plan,
   it changes). 
3. FIRE page shows the Monte Carlo card with a stable percentage (no flicker across
   re-renders with unchanged inputs).
4. Setting volatility to 0 yields 100% or 0% (nothing in between), and the p50 line
   tracks the deterministic Combined projection within rounding.
5. Raising volatility from 10 → 30 (other things equal) lowers the success rate.
6. Setting spending far above what the pots support shows ~0%, and the card renders an
   em dash (not a crash) when no FIRE age exists at all.
7. Editing volatility persists: reload the page and the value is still there; a
   pre-feature JSON export imports cleanly and shows volatility 15.
