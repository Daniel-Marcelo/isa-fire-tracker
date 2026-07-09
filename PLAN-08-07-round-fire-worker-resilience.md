# PLAN: FIRE worker resilience & fallback (rank 2)

## Goal

The FIRE page's headline numbers (earliest FIRE age / confidence) are computed in a Web
Worker ([src/lib/fireWorker.ts](src/lib/fireWorker.ts)) spun up by `FIRECalculator`. The
current wiring has **no failure path**: if the worker throws, fails to instantiate, or
never posts back, the component is stuck forever showing `…` / a permanent "Calculating…"
spinner, and the user cannot tell it's broken.

Look at [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) lines
~104–120: only `w.onmessage` is set. There is **no `w.onerror`**, no timeout, and
`setIsRecomputing(false)` is called *only* inside `onmessage`. Failure modes that leave
`isRecomputing === true` and `calc === null` permanently:

- **Worker construction throws or the module fails to load** — module workers
  (`{ type: 'module' }`) aren't supported/served in some environments; a stale PWA cache
  (the app uses `vite-plugin-pwa` with `autoUpdate`) can serve a worker chunk that
  references a hashed dependency that 404s after a deploy.
- **The worker throws at runtime** — e.g. a future change to `monteCarlo.ts` /
  `fireProjection.ts` throws on some input; the error is swallowed, no message is posted.
- **The worker hangs** — a pathological settings combination causes the binary search or
  `successCurve` loop to run very long; the UI never recovers on that tab.

Make the flagship feature degrade gracefully: catch worker errors, add a watchdog
timeout, and **fall back to computing on the main thread** so a number always appears.

## Files to touch

- **New:** `src/lib/fireCalc.ts` — extract the worker's body into a pure
  `runFireCalc(req): FireCalcResult` so both the worker and the main-thread fallback call
  the identical logic (no drift between paths)
- [src/lib/fireWorker.ts](src/lib/fireWorker.ts) — become a thin wrapper that calls
  `runFireCalc`
- [src/components/FIRECalculator.tsx](src/components/FIRECalculator.tsx) — `onerror`
  handler, watchdog timeout, main-thread fallback, an error state for the UI
- **New:** `src/lib/fireCalc.test.ts` — test the extracted function directly

## Implementation order

### Step 1 — extract the pure calc

Create `src/lib/fireCalc.ts`. Move the entire body of `self.onmessage` in `fireWorker.ts`
into an exported pure function, keeping the two run-count constants:

```ts
import type { FireSettings } from '../types';
import { runMonteCarlo, solveEarliestFireAge, successCurve, type MonteCarloResult } from './monteCarlo';
import { planToAgeOf } from './fireEngine';

export interface FireCalcRequest { id: number; settings: FireSettings; accessible: number; pension: number; }
export interface FireCalcResult {
  id: number;
  solvedAge: number | null;
  headlineAge: number | null;
  mc: MonteCarloResult | null;
  curve: { age: number; pct: number }[];
  sensitivity: { later: number; lessSpend: number } | null;
}
export const MC_RUNS = 600;
export const CURVE_RUNS = 300;

export function runFireCalc(req: FireCalcRequest): FireCalcResult {
  const { id, settings, accessible, pension } = req;
  // ...exact body currently in fireWorker.ts self.onmessage, returning the object
  // instead of calling post(...)
}
```

`fireWorker.ts` becomes:

```ts
import { runFireCalc, type FireCalcRequest, type FireCalcResult } from './fireCalc';
const post = (msg: FireCalcResult) =>
  (self as unknown as { postMessage(m: FireCalcResult): void }).postMessage(msg);
self.onmessage = (e: MessageEvent<FireCalcRequest>) => post(runFireCalc(e.data));
```

**Edge case a weaker model will miss:** `FireCalcRequest` / `FireCalcResult` are currently
imported *from `fireWorker.ts`* by `FIRECalculator.tsx`. After the move, update that import
to `../lib/fireCalc`. Grep for `from '../lib/fireWorker'` and repoint it. Keep the type
names identical so nothing else changes.

### Step 2 — main-thread fallback + error handling in the component

In `FIRECalculator.tsx`, refactor the dispatch effect (lines ~104–120). Add:

- `const [calcError, setCalcError] = useState(false);`
- A `runOnMainThread` helper that calls `runFireCalc({ id, settings: s, accessible, pension })`
  inside a `try/catch`, sets `calc`, clears `isRecomputing`, and (on catch) sets
  `calcError`. Import `runFireCalc` from `../lib/fireCalc`.

Rewrite the effect body so that after the 300 ms debounce it:

1. Tries to construct the worker inside `try { ... } catch { runOnMainThread(); return; }`.
2. Sets **both** `w.onmessage` (as today) and:
   ```ts
   w.onerror = () => { w.terminate(); runOnMainThread(); };
   ```
3. Starts a watchdog: `const watchdog = setTimeout(() => { w.terminate(); runOnMainThread(); }, 8000);`
   and clears it inside `onmessage` (right after the id check) and inside `onerror`.
4. The effect cleanup (`return () => { clearTimeout(t); clearTimeout(watchdog); }`) must
   also clear the watchdog.

**Edge cases a weaker model will miss:**
- `runFireCalc` on the main thread is synchronous and ~1–4 s; wrap the call in a
  microtask/`requestIdleCallback`-style deferral is *not* required, but do call it via a
  `setTimeout(fallback, 0)` so it doesn't run inside the `onerror`/watchdog callback stack
  while the terminated worker is still unwinding. Simplest: `runOnMainThread` schedules
  itself with `setTimeout(..., 0)`.
- Guard against double-run: the watchdog and `onerror` can both fire. Use the existing
  `reqIdRef` — capture `const id = ++reqIdRef.current` for the attempt and have
  `runOnMainThread` bail if `id !== reqIdRef.current` (a newer edit superseded it), and
  have both `onerror`/watchdog no-op after the first fallback by checking a local
  `let settled = false;` flag.
- Do **not** remove the existing worker `terminate()` on new dispatch / unmount — keep it.

### Step 3 — surface the degraded state (small, but the point of the plan)

When `calcError` is true and `calc` is non-null (fallback succeeded): render a subtle
inline note near the "Market risk" heading, e.g. `computed on this device` in
`text-slate-600` — proves the fallback ran without alarming the user.

When `calcError` is true and `calc` is still null (fallback also threw — should be
impossible, but be safe): replace the `…`/`—` headline states with a one-line error:
"Couldn't compute a projection — check your inputs." Reuse the existing `awaitingFirst`
branches; add an `else if (calcError)` arm.

### Step 4 — tests

`fireCalc.test.ts`: call `runFireCalc` directly with a realistic request and assert the
result shape (`headlineAge` a number, `mc.runs === MC_RUNS`, `curve` non-empty). Add a
degenerate request (`planToAge <= currentAge + 1` via settings) and assert it returns
`{ solvedAge: null, mc: null, curve: [] }` without throwing — this is the contract the
component's fallback relies on.

## Acceptance criteria

1. `npm test` passes; `runFireCalc` is covered directly and the worker file no longer
   contains the calc logic (it's a 3-line wrapper).
2. Manually forcing a worker failure proves recovery: temporarily `throw new Error('x')`
   at the top of `runFireCalc`, load the FIRE tab, and confirm the UI does **not** hang on
   `…` forever — it shows either a fallback number or the error line within ~8 s. (Revert
   the throw after checking.)
3. Simulate an instantiation failure (temporarily change the worker URL to a bad path):
   the FIRE age still appears (main-thread fallback), and the `computed on this device`
   note shows. (Revert after checking.)
4. Normal operation is unchanged: on a healthy load the worker path runs, no error note
   appears, and typing in inputs still debounces and recomputes as before.
5. No permanent spinner is reachable: in every failure branch, `isRecomputing` returns to
   `false`.
