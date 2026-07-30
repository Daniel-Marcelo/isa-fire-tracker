# PLAN: Stop a render error becoming a permanently white PWA (rank 8)

## Goal

There is no error boundary anywhere in the app (`grep -rl "ErrorBoundary\|componentDidCatch"
src/` returns nothing). Any throw during render unmounts the entire React tree and leaves a
blank page.

That is bad in a browser tab and worse here, because this is an installed PWA using
`vite-plugin-pwa`: the service worker serves a cached shell, so a user who hits a crash can
reload repeatedly into the *same* broken cached build with no obvious way out. The app has
several realistic throw sites — Recharts reconciling malformed series data, a `.toFixed()` on
an undefined value after a schema change, a corrupt `localStorage` cache surviving
`migrateAppData`, a stale worker chunk after a deploy.

Add a boundary that keeps the shell alive, shows the error, and offers the two recoveries
that actually work for a PWA: reload, and clear-caches-then-reload.

## Files to touch

- **New:** `src/components/ErrorBoundary.tsx`
- [src/main.tsx](src/main.tsx) — wrap the app
- [src/App.tsx](src/App.tsx) — wrap the route outlet so a crash in one tab does not kill the
  header and nav

## Implementation order

### Step 1 — the boundary

React error boundaries must be class components — there is no hook equivalent. Create
`src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown above the error; defaults to a whole-app message. */
  label?: string;
}
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack);
  }

  private hardReload = async () => {
    // A stale service-worker cache can serve the same broken build forever.
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map(r => r.unregister()));
    } catch {
      // best effort — fall through to the reload regardless
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700/60 rounded-2xl max-w-lg w-full p-6">
          <h2 className="text-base font-semibold text-slate-50">
            {this.props.label ?? 'Something went wrong'}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Your data is safe — it's stored on the server, not in this screen.
          </p>
          <pre className="mt-4 text-xs text-slate-500 bg-slate-900 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => this.setState({ error: null })}
              className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={this.hardReload}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
```

Surfaces, radii, text ramp and the indigo primary all follow the house style in
[CLAUDE.md](CLAUDE.md) — this reads as part of the app, not a browser error page. Note the
reassurance line: with Supabase persistence plus the localStorage cache, a render crash
genuinely does not lose data, and saying so is the difference between a user reloading and a
user panicking.

### Step 2 — two boundaries, not one

**Outer** — in [src/main.tsx](src/main.tsx), inside `StrictMode` and outside `BrowserRouter`,
so even a router or provider failure is contained:

```tsx
<StrictMode>
  <ErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ErrorBoundary>
</StrictMode>
```

**Inner** — in [App.tsx](src/App.tsx), wrap the `<Routes>` block inside `<main>`
([App.tsx:294-302](src/App.tsx:294)) with
`<ErrorBoundary label="This tab hit a problem">`. This is the one that matters day to day: a
Recharts crash on the FIRE tab then leaves the header, the nav and the other two tabs fully
usable, and "Try again" re-renders just that route.

### Step 3 — verify it actually catches

Temporarily add `throw new Error('boom')` at the top of
[FIRECalculator](src/components/FIRECalculator.tsx:68), run `npm run dev`, and check:
the FIRE tab shows the fallback while the header and bottom nav still work, and switching to
Portfolio renders normally. **Remove the throw afterwards.**

## Edge cases a weaker model will miss

- **Error boundaries do not catch everything.** They catch errors thrown during *render*,
  in lifecycle methods, and in constructors below them. They do **not** catch: event handler
  errors, async errors (promise rejections, `setTimeout` callbacks), or errors thrown by the
  boundary itself. Do not claim in the commit message that this makes the app crash-proof.
  The existing worker fallback in
  [FIRECalculator](src/components/FIRECalculator.tsx:131) already handles the async side for
  the heaviest computation.
- **StrictMode double-invokes render in dev**, so `componentDidCatch` logs twice locally.
  That is expected; do not "fix" it.
- **"Try again" only helps for transient failures.** If the error is deterministic — bad data
  in `AppData` — resetting state re-renders and immediately throws again. That is why
  "Reload app" (which clears caches and unregisters the service worker) is the primary,
  indigo button.
- **`navigator.serviceWorker` is undefined on insecure origins** and in some embedded
  webviews; the optional chaining plus `try/catch` above is required, not decorative.
- **Do not render the stack trace**, only `error.message`. Stacks reference bundle chunk
  paths, are meaningless to the user, and make the card unusable on a phone. The full stack
  goes to `console.error`.
- **The boundary must not read `useCurrency()`** or any context — it may be rendering
  precisely because a provider blew up. Keep it dependency-free, which the code above is.
- **`min-h-[50vh]` not `min-h-screen`** for the inner boundary: it sits inside `<main>`,
  below a sticky header and above the mobile bottom nav. A full-screen height there produces
  a scrollbar and pushes the fallback under the nav bar.

## Acceptance criteria

1. `npm run build` clean; `npm test` passes.
2. With a temporary `throw` in `FIRECalculator`, the FIRE tab shows the fallback card, **the
   header and bottom nav remain interactive**, and the Portfolio and Look-through tabs still
   render. Throw removed afterwards.
3. With a temporary `throw` in `App` itself, the outer boundary catches it and the page shows
   the fallback rather than a blank white screen.
4. "Reload app" clears the Cache Storage entries (visible in devtools → Application → Cache
   Storage) and reloads.
5. `console.error` contains the message and component stack for both cases.
6. Normal operation is completely unchanged — no visual difference anywhere when nothing
   throws.
