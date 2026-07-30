# PLAN: Fix in-place state mutation in CSV merge import, and stop passing cost off as value (rank 6)

## Goal

Two defects in [`handleCSVImport`](src/components/ISATracker.tsx:127).

**1. It mutates React state in place.** In merge mode:

```ts
const existing = [...p.holdings];                       // SHALLOW copy — same objects
for (const ph of parsed.holdings) {
  const match = existing.find(h => h.ticker?.toUpperCase() === ph.ticker.toUpperCase());
  if (match) {
    match.units    = (match.units ?? 0) + ph.units;     // writes through into rawData
    match.costBasis = (match.costBasis ?? 0) + ph.costBasis;
    match.manualValue = (match.manualValue ?? 0) + ph.costBasis;
  }
```

`[...p.holdings]` copies the array, not the holdings. `match` is the *same object* that lives
in `rawData` — i.e. in `baseData.current`. So the accumulation happens to committed app state
before `onChange` is ever called. It currently *appears* to work because `onChange` rebuilds
the tree above it and forces a re-render, but the previous state is already corrupted: if the
save fails, or the user re-runs the import, or any code path re-reads `baseData.current`
expecting pre-import values, the units and cost basis have already moved.

**2. `manualValue` is set to accumulated cost basis.** In both branches
([:139](src/components/ISATracker.tsx:139), [:150](src/components/ISATracker.tsx:150),
[:159](src/components/ISATracker.tsx:159)) the imported holding's `manualValue` — which
[`types.ts`](src/types.ts:7) documents as *"current value in native currency"* — is assigned
the **cost**. This is defensible as a fallback (a broker transaction history genuinely has no
market value in it), but nothing tells the user. In
[`holdingNativeValue`](src/lib/snapshots.ts:12) `manualValue` is the fallback when a live
price is unavailable, so any imported holding the feed cannot price displays
**value == cost, a permanent 0.0% gain**, indistinguishable from a real flat position.

## Files to touch

- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — pure merge; fallback badge
- **New:** `src/lib/mergeImport.ts` — extract the merge as a pure, testable function
- **New:** `src/lib/mergeImport.test.ts`

## Implementation order

### Step 1 — extract the merge into a pure function

Money maths belongs in `src/lib/` with a test beside it ([CLAUDE.md](CLAUDE.md)). Create
`src/lib/mergeImport.ts`:

```ts
import type { Holding, DividendRecord } from '../types';
import type { ParsedImport } from './csvParsers';

export interface MergeResult {
  holdings: Holding[];
  dividends: DividendRecord[];
}

/**
 * Merge a parsed broker export into a provider's existing holdings.
 * Pure: never mutates `existingHoldings` or any holding inside it.
 * `newId` is injected so tests are deterministic (production passes `uid`).
 */
export function mergeImport(
  existingHoldings: Holding[],
  existingDividends: DividendRecord[],
  parsed: ParsedImport,
  mode: 'replace' | 'merge',
  newId: () => string,
): MergeResult {
  const holdings: Holding[] = mode === 'replace'
    ? parsed.holdings.map(ph => ({
        id: newId(),
        name: ph.name,
        ticker: ph.ticker,
        units: ph.units,
        manualValue: ph.costBasis,
        costBasis: ph.costBasis,
        currency: ph.currency,
      }))
    : (() => {
        // Deep-copy every holding up front: the merge below must never write
        // through into the caller's state objects.
        const next = existingHoldings.map(h => ({ ...h }));
        for (const ph of parsed.holdings) {
          const match = next.find(h => h.ticker?.toUpperCase() === ph.ticker.toUpperCase());
          if (match) {
            match.units = (match.units ?? 0) + ph.units;
            match.costBasis = (match.costBasis ?? 0) + ph.costBasis;
            // Keep manualValue in step with costBasis only while it IS the cost
            // fallback. Never accumulate on top of a user-entered market value.
            match.manualValue = (match.costBasis ?? 0);
            // Do not overwrite an existing holding's currency on re-import — a
            // manually-set (or previously imported) currency must not flip.
          } else {
            next.push({
              id: newId(),
              name: ph.name,
              ticker: ph.ticker,
              units: ph.units,
              manualValue: ph.costBasis,
              costBasis: ph.costBasis,
              currency: ph.currency,
            });
          }
        }
        return next;
      })();

  let dividends: DividendRecord[];
  if (mode === 'replace') {
    dividends = parsed.dividends;
  } else {
    // Union by id so re-importing an overlapping export never double-counts income.
    const seen = new Set(existingDividends.map(d => d.id));
    dividends = [...existingDividends, ...parsed.dividends.filter(d => !seen.has(d.id))];
  }
  return { holdings, dividends: [...dividends].sort((a, b) => a.date.localeCompare(b.date)) };
}
```

`handleCSVImport` in the component then reduces to a call:

```ts
function handleCSVImport(providerId: string, parsed: ParsedImport, mergeMode: 'replace' | 'merge') {
  onChange({
    ...rawData,
    providers: rawData.providers.map(p => {
      if (p.id !== providerId) return p;
      const { holdings, dividends } = mergeImport(p.holdings, p.dividends ?? [], parsed, mergeMode, uid);
      return { ...p, holdings, dividends, lastCsvImport: new Date().toISOString() };
    }),
  });
}
```

### Step 2 — surface the cost-basis fallback in the UI

No schema change needed: the condition is derivable. A holding is showing a *placeholder*
value when it has a ticker and units but no resolved live price:

```ts
const isFallbackValue = h.ticker != null && h.units != null && h.currentPrice == null;
```

In both the mobile card ([ISATracker.tsx:479](src/components/ISATracker.tsx:479)) and the
desktop table row ([ISATracker.tsx:533](src/components/ISATracker.tsx:533)), render a small
muted marker next to the value when `isFallbackValue` — e.g. `no price` in
`text-slate-500`, with a `title` of "Showing cost basis — no live price for this ticker".

Do **not** use `green-400`/`red-400` here; [CLAUDE.md](CLAUDE.md) reserves those for
gains/losses.

### Step 3 — tests

`src/lib/mergeImport.test.ts`, with a deterministic `newId` (`let n = 0; () => \`id${n++}\``):

1. **Purity (the headline test).** Deep-freeze the input holdings
   (`Object.freeze` each object plus the array) and run a merge that matches an existing
   ticker. It must not throw, and the original objects' `units`/`costBasis` must be unchanged
   afterwards.
2. Merging a matching ticker sums units and cost basis.
3. Merging is case-insensitive on ticker (`vusa` matches `VUSA`).
4. Merging does **not** change an existing holding's `currency`, even when the import carries
   a different one.
5. Replace mode discards existing holdings entirely and assigns fresh ids.
6. Dividends union by `id` — importing an overlapping export twice yields each dividend once.
7. Dividends come back sorted ascending by date.
8. Merging the same CSV twice doubles units (that is correct broker-transaction behaviour and
   the reason the confirm step in the modal matters) — assert it explicitly so the behaviour
   is pinned rather than accidental.

## Edge cases a weaker model will miss

- **`Object.freeze` is shallow.** For test 1, freeze the array *and* each holding object, or
  the mutation slips through undetected and the test passes against buggy code.
- **`manualValue` must not accumulate independently.** The old line
  `match.manualValue = (match.manualValue ?? 0) + ph.costBasis` drifts away from `costBasis`
  as soon as a user has ever typed a manual value. Assigning `match.costBasis` (as above)
  keeps the fallback coherent. Do not simply delete `manualValue`: `holdingNativeValue`
  returns `null` without it, which makes
  [`providerGbpTotal`](src/lib/snapshots.ts:26) refuse to snapshot the whole provider.
- **The `?? 0` on `match.costBasis` matters.** `costBasis` is optional in
  [`types.ts`](src/types.ts:6); a holding added by hand may not have one.
- **`stripDerived`** removes `currentPrice`/`currentValue` before persistence
  ([store.ts:44](src/store.ts:44)). The merge operates on `rawData`, which is already clean —
  do not add another strip.
- **`ParsedImport.holdings[].costBasis` is in the instrument's own currency**, not the
  display currency — see the comment at
  [csvParsers.ts:56](src/lib/csvParsers.ts:56). The merge must not convert anything; it is
  pure bookkeeping in native units.
- **Do not "improve" the dedupe to match on name as well as ticker.** HL's parser already
  keys by description because it has no ticker
  ([csvParsers.ts:280](src/lib/csvParsers.ts:280)); a name-based match would merge unrelated
  positions across providers.

## Acceptance criteria

1. `npm run build` clean; `npm test` passes, including the frozen-input purity test.
2. The purity test fails if you revert `mergeImport` to a shallow copy — verify this
   deliberately, then restore the fix. A test that cannot fail is not a test.
3. Import a Trading 212 CSV in merge mode twice. Units and cost basis double (expected), and
   dividends do **not** double.
4. A holding whose ticker the price feed cannot resolve shows the muted `no price` marker and
   a value equal to its cost basis, instead of silently reporting a 0.0% gain.
5. `handleCSVImport` in `ISATracker.tsx` is under ~12 lines and contains no `for` loop or
   assignment to a holding property.
