# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Personal finance web app for tracking UK Stocks & Shares ISAs, SIPPs, and GIAs across multiple providers, with a FIRE calculator (deterministic projection + Monte Carlo + drawdown). Single admin user (`VITE_ADMIN_EMAIL`); Supabase handles auth and cloud persistence behind a localStorage cache. Hosted on Vercel.

A React Native port lives in the sibling folder `../isa-fire-mobile` — changes here do **not** automatically apply there.

## Commands

```bash
npm run dev            # Vite dev server
npm run build          # tsc -b && vite build — must pass before any commit (see below)
npm test               # vitest run (one-shot)
npm run lint           # eslint .
npx vitest run src/lib/fireCalc.test.ts    # run a single test file
npx vitest -t "name"   # run tests matching a name
```

- **Always run `npm run build` before committing.** Vercel fails the deploy on TypeScript errors that `npm run dev` tolerates — `tsc -b` runs as part of the build but not the dev server.
- **Run `npm test` after touching anything in `src/lib/` or `src/store.ts`.** All money maths is covered by Vitest and much of it is subtle (currency round-trips, pence normalisation, tax-year boundaries).

## Architecture

### State + persistence pipeline (the core of the app)

`App.tsx` owns all app state and orchestrates a specific data flow. Understand this before touching state:

- **Two copies of `AppData` exist at all times.** `baseData` (a ref) holds the *stored* shape — native currencies, no derived fields. The `data` state passed to tabs is `baseData` run through `applyLivePrices()` — converted to the user's display currency with `currentPrice`/`currentValue` filled in. Components receive both: `data` (display) and `rawData` (= `baseData.current`, for edits). **Edits produce a new `baseData`; never edit the derived copy.**
- **Derived fields are stripped before persistence.** `Holding.currentPrice` and `currentValue` are runtime-only. `stripDerived()` / `store.ts` removes them on save and export so they never round-trip through Supabase. Adding a runtime-derived field means updating `stripDerived`.
- **Saves are debounced (1s) and blocked in degraded mode.** If the initial load from Supabase fails, the app enters **degraded mode**: it shows the last localStorage cache read-only and `scheduleSave` becomes a no-op, so a failed load can never overwrite good remote data with a stale/empty portfolio. `degradedRef` mirrors the flag because the debounced closure would otherwise read stale state.
- **`migrateAppData()` (`store.ts`) is the single migration/normalisation choke point.** It backfills defaults and converts legacy shapes (e.g. old `currentValue` → `manualValue`). Everything loaded or imported passes through it. Add new fields' defaults here.

### The money / price / FX pipeline

This is where the real bugs have been; treat it carefully.

- **Base storage currency is per-holding native** (`Holding.currency`, ISO 4217, default `GBP`). The user picks a *display* currency (`userSettings.currency`); all conversion happens on the way to the screen via `applyLivePrices` + `convertAmount` (`fxRates.ts`). **Never convert an already-converted value** — round-trip tests in `currencyRoundTrip.test.ts` guard this.
- **Live prices come from the `nw-scrape` Firestore project** (`firebasePrices.ts`), a separate repo scraping TradingView. Read via the public Firestore REST API — no SDK. LSE prices arrive in pence (`GBp`/`GBX`) and are normalised to pounds inside this module, so every price leaving it is in major-unit ISO currency. The full stock list is cached (4-min TTL) with a per-ticker single-doc fallback for tickers missing from the cached pages.
- **A live price's currency comes from the feed, not the holding.** `applyLivePrices` values ticker'd holdings using the feed's currency (so mistagged CSV imports still render right) but always uses the holding's own currency for cost basis.
- **FX rates** come from `api.frankfurter.app` (`fxRates.ts`). App refreshes prices + rates on load and every 5 minutes.
- **Snapshots** (`snapshots.ts`): `withTodaySnapshots` records a daily portfolio total per provider, but only when the provider can be valued *trustworthily* — if any ticker'd holding lacks a live price this session, or any currency lacks an FX rate, the provider is skipped rather than recording a wrong number.

### FIRE calculator

- `fireEngine.ts` / `fireProjection.ts` / `fireCalc.ts` — projection maths. `fireCalc.runFireCalc` is a **pure function** wrapping the full Monte Carlo suite.
- `monteCarlo.ts` — the simulation itself.
- `fireWorker.ts` — a Web Worker that runs `runFireCalc` off the main thread (one recompute ≈ 40 simulations, ~4s on-thread) so typing in the FIRE inputs never blocks. `FIRECalculator.tsx` calls the identical pure function on the main thread as a fallback. **Keep `fireCalc.ts` pure and worker-safe** — no DOM, no React.

### Persistence tables (Supabase)

- `user_data` — one row per user, whole `AppData` as JSON in a `data` column (`db.ts`).
- `fund_holdings` — uploaded Vanguard fund look-through data, keyed by `fund_ticker`.
- Schema lives in `supabase-schema.sql`. SQL changes are applied via the Supabase MCP server (or by hand in the dashboard SQL editor if the MCP is unavailable).

### Import surfaces

- `csvParsers.ts` — provider CSV imports (holdings + dividend records).
- `fundHoldingsParser.ts` — Vanguard xlsx fund-holdings uploads (`xlsx`), feeding the Look-Through tab (underlying-holdings exposure). Admin-only `/funds` route manages these.

### Routing / tabs

`react-router-dom`. Tabs: `/` Portfolio (`ISATracker`), `/lookthrough` (`LookThrough`), `/fire` (`FIRECalculator`), and admin-only `/funds` (`FundManager`). `CurrencyContext` provides `fmt`/`fmtShort` formatters wired to the chosen display currency.

## Conventions

- **All new money maths must ship with a Vitest test alongside it in `src/lib/`.**
- UK tax year starts 6 April; `currentTaxYear()` in `store.ts` is the canonical helper (year `2025` means tax year 2025/26). Don't reinvent the boundary logic.
- `PLAN-*.md` files in the repo root are implementation plans (from the `/plans` command). Delete one when you finish executing it.

## Environment

`.env.local` (also set in Vercel): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_EMAIL`. Admin-gated UI keys off `user.email === VITE_ADMIN_EMAIL`.
