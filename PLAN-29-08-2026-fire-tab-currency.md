# PLAN: Make the FIRE tab GBP-only instead of silently mixing currencies (rank 5)

## Goal

Switch the app to USD and the FIRE tab produces wrong numbers, confidently.

The pot values are read from the **display-converted** `data`:

```ts
// src/components/FIRECalculator.tsx:79-85
const accessibleValue = data.providers.filter(...).reduce(... h.currentValue ...)
```

`data` is the output of [`applyLivePrices`](src/lib/applyLivePrices.ts:4), which converts
every `currentValue` into `userSettings.currency`. But every money **input** on that tab is
hardcoded to sterling:

| What | Where |
|------|-------|
| Monthly contribution | [`prefix="£"`](src/components/FIRECalculator.tsx:422) |
| Monthly pension contribution | [`prefix="£"`](src/components/FIRECalculator.tsx:431) |
| Annual spending in retirement | [`<span>£</span>`](src/components/FIRECalculator.tsx:442) |
| State pension amount | [`prefix="£"`](src/components/FIRECalculator.tsx:408) |
| Year-by-year `Delta` tooltip | [`currency: 'GBP'`](src/components/FIRECalculator.tsx:654) |
| Table header hints | [`£${monthlyContribution}`](src/components/FIRECalculator.tsx:303) |

So in USD mode the engine draws a $-denominated pot down by £-denominated spending, and the
resulting FIRE age — the headline number of the whole app — is wrong by the GBP/USD rate.
The tooltips inside the table render `£` while the column above them renders `$`.

**Decision: the FIRE tab is GBP-only.** That is the right call rather than converting the
settings, because the domain is inherently sterling — UK state pension, pension access age,
ISA allowance, HMRC drawdown tax — and [CLAUDE.md](CLAUDE.md) already states GBP is the base
currency. Converting `FireSettings` per-keystroke would round-trip user input through FX on
every edit, which is exactly the class of bug `currencyRoundTrip.test.ts` exists to prevent.

The fix is therefore: **feed the FIRE tab GBP pot values**, keep the `£` labels (they become
correct rather than misleading), and say so in the UI.

## Files to touch

- [src/App.tsx](src/App.tsx) — build a GBP-denominated view alongside the display view
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — consume it,
  format in GBP, add a note
- **New:** `src/lib/gbpView.test.ts` — assert the GBP view is currency-independent

## Implementation order

### Step 1 — a GBP view in `App.tsx`

`applyLivePrices` already does exactly the needed conversion; it just reads the target
currency off `base.userSettings.currency`
([applyLivePrices.ts:10](src/lib/applyLivePrices.ts:10)). Build a second view with that
field forced to GBP.

Where `data` is currently produced ([App.tsx:146](src/App.tsx:146) and
[App.tsx:165](src/App.tsx:165)), also produce and store:

```ts
const [gbpData, setGbpData] = useState<AppData>(defaultData);

// helper, defined once near the other callbacks
const toGbpView = (base: AppData, prices, rates, ccys): AppData =>
  applyLivePrices(
    { ...base, userSettings: { ...base.userSettings, currency: 'GBP' } },
    prices, rates, ccys,
  );
```

Set `gbpData` everywhere `setData` is called with an `applyLivePrices` result — there are
exactly **two** such call sites (`refreshLivePrices` and `handleChange`). Both must be
updated; missing `handleChange` means the FIRE tab freezes at load-time values whenever the
user edits a holding.

Pass it to the route:

```tsx
<Route path="/fire" element={
  <FIRECalculator data={gbpData} rawData={baseData.current} onChange={handleChange} />
} />
```

Note that `rawData` and `onChange` are unchanged — `FireSettings` was always stored in GBP;
only the *display* was inconsistent.

### Step 2 — `FIRECalculator.tsx`

Replace the currency context with fixed GBP formatters:

```ts
// was: const { fmt, fmtShort } = useCurrency();
const fmt = (v: number) => formatCurrency(v, 'GBP');
const fmtShort = (v: number) => formatCurrencyShort(v, 'GBP');
```

Import both from [src/utils.ts](src/utils.ts) and drop the now-unused `useCurrency` import.
Every `£` prefix, and the hardcoded GBP in `Delta`
([FIRECalculator.tsx:654](src/components/FIRECalculator.tsx:654)), now agree with the data —
leave them exactly as they are.

Add one line of honesty to the Assumptions card header
([FIRECalculator.tsx:383](src/components/FIRECalculator.tsx:383)):

```tsx
<h3 className="font-semibold text-slate-100 mb-4">
  Assumptions
  <span className="ml-2 text-xs font-normal text-slate-500">All FIRE figures in GBP</span>
</h3>
```

Slate-500 muted text is the established treatment for this kind of caption per the house
style in [CLAUDE.md](CLAUDE.md).

### Step 3 — test

`src/lib/gbpView.test.ts` — this is money maths, so a Vitest test is required
([CLAUDE.md](CLAUDE.md) convention):

1. Build an `AppData` with a USD holding (`currency: 'USD'`, `units`, `costBasis`) and a GBP
   holding, plus `fxRates = { GBP: 1, USD: 1.25 }`.
2. Apply the GBP view with `userSettings.currency = 'USD'` on the base, and assert the
   totals equal the same view computed with `userSettings.currency = 'GBP'`.
   **The GBP view must be independent of the user's display currency** — that is the whole
   invariant this plan buys.
3. Assert a USD holding priced at $125 with 10 units yields £1000 at a 1.25 rate.
4. Assert `costBasis` is converted once and only once (compare against a hand-computed
   value) — mirror the style of
   [currencyRoundTrip.test.ts](src/lib/currencyRoundTrip.test.ts).

## Edge cases a weaker model will miss

- **`applyLivePrices` decouples the price currency from the holding currency**
  ([applyLivePrices.ts:27](src/lib/applyLivePrices.ts:27)): live prices are converted using
  the *feed's* currency, cost basis using the *holding's*. Forcing the target to GBP does not
  disturb that — but do not "simplify" the function while you are in there.
- **Do not convert `data` back to GBP.** Taking the already-converted `currentValue` and
  running `convertAmount(v, userCurrency, 'GBP', rates)` on it is the double-conversion
  pattern [CLAUDE.md](CLAUDE.md) explicitly warns about, and it compounds float error. Build
  the view from `baseData.current` as shown.
- **`FIRECalculator` writes settings back through `rawData`**
  ([FIRECalculator.tsx:75-77](src/components/FIRECalculator.tsx:75)) — that comment explains
  why. Nothing about this plan changes it; do not repoint `update()` at `data`.
- **The Portfolio tab keeps the user's chosen currency.** Only the FIRE route gets `gbpData`.
  Do not swap `ISATracker`'s or `LookThrough`'s props.
- **`useDeferredValue(s)`** at [FIRECalculator.tsx:99](src/components/FIRECalculator.tsx:99)
  defers the *settings*, not the pots. Changing pot values still recomputes immediately —
  that is intended, leave it.
- **Recharts `tickFormatter={fmtShort}`** now receives the GBP formatter; axis labels will
  read `£` on the FIRE charts while the Portfolio tab reads `$`. That is the intended
  outcome, not a bug to "fix".

## Acceptance criteria

1. `npm run build` clean; `npm test` passes including the new `gbpView.test.ts`.
2. With a non-trivial portfolio, note the FIRE age in GBP mode. Switch the app currency to
   USD via the user menu. **The FIRE age, confidence, and required saving are identical**,
   and every figure on the tab still renders with `£`. (Before this change the FIRE age moves
   substantially.)
3. The "ISA / GIA / Cash" and "Pension / SIPP" pot cards on the FIRE tab show the same GBP
   totals in both currency modes.
4. The Portfolio tab still renders in the user's selected currency — this plan must not
   change it.
5. The year-by-year table and its hover tooltips agree: both `£`.
6. Editing a holding on the Portfolio tab immediately updates the FIRE tab's pot values
   (proves `handleChange` sets `gbpData` too).
