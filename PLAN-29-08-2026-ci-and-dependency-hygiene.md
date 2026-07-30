# PLAN: Make the build rules enforceable and clear the dependency advisories (rank 7)

## Goal

Two pieces of unglamorous hygiene that pay for themselves.

**1. The project's own rules are honour-system.** [CLAUDE.md](CLAUDE.md) says *"Always run
`npm run build` before committing"* and *"Run `npm test` after touching anything in
`src/lib/`"*. There is no `.github/` directory — nothing enforces either. Vercel builds on
push (so a TS error is caught eventually, in the deploy) but **`npm test` and `npm run lint`
never run automatically at all**. The entire financial-maths suite — the thing that makes
this app trustworthy — can be broken and pushed without anyone noticing until a number looks
wrong.

**2. Three dependency advisories, two with fixes already available.** `npm audit --omit=dev`
on 2026-07-29:

| Package | Severity | Fix |
|---------|----------|-----|
| `react-router` / `react-router-dom` 7.17.0 | high (5 advisories: open redirect, XSS, DoS, CSRF bypass) | available |
| `postcss` <=8.5.17 | high (path traversal in source-map loading) | available |
| `xlsx` * | high (prototype pollution, ReDoS) | **none on npm** |

The `xlsx` one needs a judgement call, not a bump — see Step 3.

## Files to touch

- **New:** `.github/workflows/ci.yml`
- [package.json](package.json) — dependency bumps, and a `ci` script
- [package-lock.json](package-lock.json) — regenerated
- [CLAUDE.md](CLAUDE.md) — note that CI now enforces the rules

## Implementation order

### Step 1 — CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build      # tsc -b && vite build — the rule CLAUDE.md states
      - run: npm test           # vitest run
      - run: npm run lint
```

`npm run build` runs `tsc -b`, so type errors fail CI — which is precisely the failure mode
[CLAUDE.md](CLAUDE.md) warns about ("Vercel fails the deploy on TypeScript errors that
`npm run dev` tolerates").

**The build needs no secrets.** The `VITE_*` env vars are read at runtime via
`import.meta.env` and are `undefined` at build time in CI; that is fine — Vite inlines
`undefined` and the bundle still compiles. Do **not** add the Supabase keys to GitHub
secrets for this; the build does not need them and it widens the blast radius for no gain.

Add a convenience script to [package.json](package.json) so the same gate can be run locally
in one command:

```json
"ci": "npm run build && npm test && npm run lint"
```

### Step 2 — the two fixable advisories

```bash
npm audit fix
```

That should move `react-router-dom` and `postcss` without a major bump. Then verify the
router still behaves, because routing is load-bearing here — [App.tsx](src/App.tsx) uses
`Routes`, nested `Routes`, `NavLink`, `Navigate` and `useLocation`, and
[vercel.json](vercel.json) rewrites every path to `index.html` for client-side routing.

If `npm audit fix` proposes a **major** version of `react-router-dom`, stop and do it as a
separate change — do not fold a router major into a hygiene commit.

### Step 3 — the `xlsx` decision

`npm audit` reports "No fix available" because SheetJS stopped publishing to npm; the npm
`xlsx` package is frozen at 0.18.5 and will never be patched there. Current usage is narrow:
[`fundHoldingsParser.ts`](src/lib/fundHoldingsParser.ts) parses Vanguard fund-holdings
workbooks, reached only from [`FundManager`](src/components/FundManager.tsx), which is
admin-only (`isAdmin` gate at [App.tsx:298](src/App.tsx:298)).

So the exposure is: one signed-in admin, feeding files they chose themselves, into a parser
with known prototype-pollution and ReDoS advisories. Low, but it is a parser and it will
never be patched.

Pick **one** and record the reasoning in the commit message:

- **(a) Move to the SheetJS-hosted build** — `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
  Gets the patched code. Cost: the dependency no longer resolves from the npm registry,
  which can complicate `npm ci` in CI. **Verify the CI job from Step 1 still installs** before
  committing.
- **(b) Keep 0.18.5 and accept the risk**, adding a one-line comment at the top of
  `fundHoldingsParser.ts` recording that the advisory is known, the input is admin-supplied,
  and the reason it was accepted.

Recommendation: **(a)**, with (b) as the fallback if `npm ci` in CI cannot resolve the
tarball. Do not silently leave it unaddressed and undocumented — that is the only genuinely
wrong option.

### Step 4 — reflect it in CLAUDE.md

Under **Workflow rules**, append one line so the next agent knows the gate is real:

```md
- CI (`.github/workflows/ci.yml`) runs `build`, `test` and `lint` on every push and PR —
  the same three commands as `npm run ci`. Run it locally before pushing.
```

## Edge cases a weaker model will miss

- **`npm ci` requires `package-lock.json` to be in sync with `package.json`.** After any
  dependency change, commit the regenerated lockfile in the same commit or CI fails on the
  install step with a confusing error.
- **`npm audit fix` can quietly bump a transitive major.** Diff `package.json` *and* the
  lockfile after running it; if `react-router-dom` moved to a new major, back it out.
- **Do not add `--audit-level` gating to CI yet.** With `xlsx` unfixable on npm, an
  `npm audit` step would fail every run and train everyone to ignore red. Add the audit step
  only after Step 3 resolves.
- **Node version.** [package.json](package.json) pins Vite 8 / TypeScript 6; use Node 22 in
  CI to match a current local toolchain. If `npm run build` fails in CI but passes locally,
  check the local `node --version` first before changing anything else.
- **`eslint.config.js` already ignores `dist`** ([eslint.config.js](eslint.config.js)), so
  `npm run lint` in CI will not trip over build output. If lint currently fails on existing
  code, fix the violations in a **separate** commit before turning the gate on — a CI job that
  is red on arrival gets disabled within a week.
- **Windows line endings.** The repo is developed on Windows and git reports
  `LF will be replaced by CRLF` warnings. This does not affect CI (Linux), but do not add a
  `.gitattributes` normalisation pass as part of this change — it would rewrite every file
  and bury the actual diff.

## Acceptance criteria

1. `npm run ci` passes locally, end to end.
2. The workflow runs on a pushed branch and all three steps are green in the Actions tab.
3. Deliberately break a test (flip an assertion in
   [src/lib/fireEngine.test.ts](src/lib/fireEngine.test.ts)), push, and confirm CI **fails**.
   Revert. A gate that has never gone red is unproven.
4. `npm audit --omit=dev` reports no `react-router` and no `postcss` advisories.
5. `xlsx` is either upgraded to a patched SheetJS build **or** documented in
   `fundHoldingsParser.ts` with the reason — and the choice is stated in the commit message.
6. The Look-Through tab still parses a real Vanguard `.xlsx` upload after whatever `xlsx`
   change was made. This is the one manual check that cannot be skipped.
7. [CLAUDE.md](CLAUDE.md) mentions the CI gate.
