# PLAN: "Required monthly contribution" goal-seek (rank 4)

## Goal

Today the FIRE calculator answers one direction: *given my contributions, when can I
retire?* (`earliest` mode) or *given an age, what's my confidence?* (`fixedAge` mode). The
most actionable planning question is the inverse: **"To retire at age X with my target
confidence, how much do I need to save each month?"** Add a solver + a single result card.
It's high user value and low risk because it reuses the existing pure engine — no new
financial maths, just a binary search over `monthlyContribution`.

## Why this is safe/cheap

`runMonteCarlo(settings, accessible, pension, retireAge)` success rate is **monotonically
non-decreasing in `monthlyContribution`** (more accumulation → more terminal wealth → the
plan survives at least as often). That monotonicity is the same property the existing
`solveEarliestFireAge` binary search relies on, so a binary search over contribution is
valid and deterministic (reuse `MC_SEED`).

## Files to touch

- [src/lib/monteCarlo.ts](src/lib/monteCarlo.ts) — new pure `solveRequiredContribution(...)`
- [src/lib/monteCarlo.test.ts](src/lib/monteCarlo.test.ts) — tests for it
- [src/lib/fireCalc.ts](src/lib/fireCalc.ts) *(if the rank-2 worker refactor has landed)*
  or [src/lib/fireWorker.ts](src/lib/fireWorker.ts) — compute it in the worker and add to
  `FireCalcResult`
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — render one card

> Sequencing note: this is cleaner **after**
> [PLAN-08-07-round-fire-worker-resilience.md](PLAN-08-07-round-fire-worker-resilience.md),
> because you add one field to `FireCalcResult` in a single extracted function rather than
> in the worker + component type twice. If that plan hasn't landed, add the field to the
> `FireCalcResult` in `fireWorker.ts` and update the import in the component.

## Implementation order

### Step 1 — the pure solver

In `monteCarlo.ts`, add. It solves the **total** monthly saving needed, holding the current
accessible:pension split fixed so the answer respects the user's existing pension routing:

```ts
/**
 * Smallest total monthly contribution (accessible + pension combined) whose Monte Carlo
 * success rate at `retireAge` meets the settings' target confidence, holding the current
 * accessible:pension contribution ratio fixed. Returns null if even a very large
 * contribution can't reach the target (e.g. retireAge below currentAge, or spending so
 * high the bridge fails structurally), and 0 if the current pots already suffice with no
 * contributions.
 */
export function solveRequiredContribution(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
  retireAge: number,
  opts: MonteCarloOptions = {},
): number | null {
  const target = targetConfidenceOf(settings) / 100;
  const acc0 = Math.max(settings.monthlyContribution, 0);
  const pen0 = Math.max(settings.monthlyPensionContribution ?? 0, 0);
  const base = acc0 + pen0;
  // Split ratio: if the user contributes nothing today, route new money to accessible
  // (the ISA bridge is what usually binds for early retirement).
  const accShare = base > 0 ? acc0 / base : 1;

  const rateAt = (total: number) => {
    const s2: FireSettings = {
      ...settings,
      monthlyContribution: total * accShare,
      monthlyPensionContribution: total * (1 - accShare),
    };
    return runMonteCarlo(s2, accessibleStart, pensionStart, retireAge,
      { runs: opts.runs ?? DEFAULT_RUNS, seed: opts.seed ?? MC_SEED, endAge: opts.endAge }).successRate;
  };

  if (rateAt(0) >= target) return 0;

  // Find an upper bound that meets the target (double until it does, capped).
  let hi = Math.max(base, 500);
  let guard = 0;
  while (rateAt(hi) < target) {
    hi *= 2;
    if (++guard > 20) return null;         // unreachable at any sane saving rate
  }
  let lo = 0;
  // Binary search to ~£10/month resolution.
  while (hi - lo > 10) {
    const mid = (lo + hi) / 2;
    if (rateAt(mid) >= target) hi = mid; else lo = mid;
  }
  return Math.ceil(hi / 10) * 10;          // round up to the nearest £10, stay >= target
}
```

**Edge cases a weaker model will miss:**
- Guard `retireAge <= settings.currentAge` → return `null` before searching (a
  zero-length accumulation can't be solved and `runMonteCarlo` would treat it oddly).
- The `while (hi - lo > 10)` loop must be entered only after establishing
  `rateAt(hi) >= target`; the doubling loop guarantees that or returns `null`.
- Round **up** (`Math.ceil`), never down — rounding down could drop back below the
  confidence target and make the card lie.
- Use the same `runs` as the headline (600 in the worker) so the number is consistent with
  the confidence shown elsewhere; do not silently use `DEFAULT_RUNS` (1000) in the worker.

### Step 2 — compute it in the worker/calc

In the worker body (or `runFireCalc`), after `headlineAge`/`chosenAge` are known:

```ts
const targetAge = mode === 'earliest' ? (solvedAge ?? chosenAge) : chosenAge;
const requiredContribution = degenerate ? null
  : solveRequiredContribution(settings, accessible, pension, targetAge, { runs: MC_RUNS });
```

Add `requiredContribution: number | null` to `FireCalcResult` and include it in the posted
object. **Edge case:** in `earliest` mode the user is *already* at/above target by
construction, so `requiredContribution` will typically equal (or be below) their current
saving — that's still useful ("you could save £X and retire at the same age"), but label
the card correctly per mode (see Step 3).

### Step 3 — one result card in `FIRECalculator.tsx`

Read `calc?.requiredContribution`. Place a card near the hero. Copy depends on mode:

- **fixedAge mode:** headline = `fmt(requiredContribution)` /mo, sublabel
  "to retire at {chosenAge} with ≥{confTarget}% confidence". If `requiredContribution`
  is `0`: "Your current pots already clear {confTarget}% — no further saving required."
  If `null`: "Not reachable at {chosenAge} by saving alone — push the age out or trim
  spending."
- **earliest mode:** show it as a secondary line under the FIRE age:
  "Saving {fmt(requiredContribution)}/mo would sustain retirement at {solvedAge}."

Compare against the user's current `s.monthlyContribution + (s.monthlyPensionContribution ?? 0)`
and render a delta chip ("+£{n}/mo more than today" / "£{n}/mo less than today") using the
existing chip styling (`bg-slate-900/70 border border-slate-700 rounded-full`).

**Edge case:** `requiredContribution` is a **total** across accessible+pension; the card
copy must say "total monthly saving", not "into your ISA", to avoid implying it all goes
to one pot.

### Step 4 — tests

In `monteCarlo.test.ts`:
- Ample pots, modest spending → `solveRequiredContribution === 0`.
- Absurd spending / retire-next-year with tiny pots and short horizon → `null`.
- Monotonicity sanity: the solved contribution, plugged back into `runMonteCarlo` at
  `retireAge`, yields `successRate >= targetConfidence`, and `solved - 20` yields a rate
  **below** target (proves it's the minimum, within rounding).
- Determinism: same inputs → identical result.

## Acceptance criteria

1. `npm test` passes with the new solver tests, including the "solved meets target,
   solved−ε misses" boundary test.
2. In `fixedAge` mode, the card shows a plausible £/mo that, when the user actually types
   it into the contribution inputs, moves the displayed confidence to **≥ the target**
   (verify live: read the required number, enter it, watch confidence cross the target).
3. Setting spending absurdly high (e.g. £500k/yr) shows the "not reachable by saving
   alone" copy, not a spinner or a wrong number.
4. The card's total never routes 100% to one pot when the user currently splits
   contributions — the accessible:pension ratio is preserved.
5. The number is stable across identical renders (no flicker from re-seeding).
