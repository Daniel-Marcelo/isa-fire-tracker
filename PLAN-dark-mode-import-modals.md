# PLAN: Dark-Mode the Import & Fund Screens (rank 5)

## Goal

Commit `b7a55a8` ("Complete dark-mode redesign") missed three screens, which still
render light-theme (white cards, gray borders, dark-on-white text) inside the dark app.
On the near-black `#02061a` background they look broken, and some text is unreadable
(light-gray labels on the dark `Modal` shell):

1. [src/components/CSVImportModal.tsx](src/components/CSVImportModal.tsx) — entire body
   is light (`text-gray-700` labels, `border-gray-200` selects with default white
   option styling, `bg-red-50`/`bg-emerald-50` banners, `bg-gray-50` table header,
   white-ish buttons). It renders *inside* the dark `Modal` component, so the mismatch
   is immediately visible from Portfolio → "Import CSV".
2. [src/components/FundManager.tsx](src/components/FundManager.tsx) — the admin
   `/funds` page: `text-gray-900` heading (invisible on dark bg), `bg-white` empty
   state, light fund cards.
3. [src/components/FundUploadModal.tsx](src/components/FundUploadModal.tsx) — has its
   own hand-rolled modal shell (`bg-white rounded-2xl`), fully light.

Restyle all three to the app's established dark idiom. No behaviour changes — className
edits only (plus one structural swap noted in step 3).

## Files to touch

- src/components/CSVImportModal.tsx
- src/components/FundManager.tsx
- src/components/FundUploadModal.tsx

Reference components for the target idiom (read them first, copy classes verbatim):
- [src/components/Modal.tsx](src/components/Modal.tsx) — modal shell, headers
- [src/components/ISATracker.tsx](src/components/ISATracker.tsx) — `HoldingModal` /
  `ProviderModal` for inputs, labels, buttons; card/table styling
- [src/components/AuthScreen.tsx](src/components/AuthScreen.tsx) — error/success banners

## Class translation table

Apply these mappings consistently (left = current light class → right = replacement):

| Light | Dark replacement |
|---|---|
| `bg-white` (card/shell) | `bg-slate-800 border border-slate-700/60` (modal) or `bg-slate-800/70 border border-slate-700/50` (page card) |
| `text-gray-900` (headings) | `text-slate-100` |
| `text-gray-700` (labels) | `text-slate-400` |
| `text-gray-600` | `text-slate-400` |
| `text-gray-500` | `text-slate-500` |
| `text-gray-400` (hints) | `text-slate-600` |
| `text-gray-300` / `text-gray-200` (icons) | `text-slate-600` |
| `border-gray-200` / `border-gray-100` | `border-slate-700` (containers) / `border-slate-600` (inputs) |
| `divide-gray-50` | `divide-slate-700/30` |
| `bg-gray-50` (table head, hover) | `bg-slate-900/60` (table head) / `hover:bg-slate-700` (hover) |
| inputs/selects (`border-gray-200 …`) | full input recipe: `border border-slate-600 bg-slate-900 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500` |
| `bg-red-50 text-red-700` / `text-red-600` | `bg-red-900/20 border border-red-800/40 text-red-400 rounded-xl` |
| `bg-emerald-50 text-emerald-700` / `bg-green-50 text-green-…` | `bg-green-900/20 border border-green-800/40 text-green-400` |
| `text-amber-600` | `text-amber-400` |
| `bg-indigo-50/30`, `bg-indigo-50` (dropzone hover/drag) | `bg-indigo-950/40` |
| `hover:bg-indigo-700` on primary buttons | `hover:bg-indigo-500` (matches the rest of the app) |
| secondary button `border-gray-200 text-gray-600 hover:bg-gray-50` | `border border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200` |
| `bg-black/40` overlay | `bg-black/70 … backdrop-blur-sm` (match Modal.tsx) |

## Implementation order

### Step 1 — CSVImportModal.tsx

Work top to bottom through the file applying the table. Specifics:
- Both `<select>` elements: use the full dark input recipe; native `<option>`s inherit
  the dark `bg-slate-900` from the select — also confirm the select has an explicit
  `bg-slate-900`, otherwise Windows Chrome renders a white dropdown with white text.
- Drop zone: `border-2 border-dashed border-slate-700 … hover:border-indigo-500 hover:bg-indigo-950/40`.
- Preview table: header `bg-slate-900/60 text-slate-600`, body text `text-slate-100`
  (ticker), `text-slate-500` (name), `text-slate-300` (numbers), `border-t border-slate-700/30`.
- "Import mode" toggle buttons: selected state stays `bg-indigo-600 text-white
  border-indigo-600`; unselected becomes `bg-slate-800 text-slate-400 border-slate-700
  hover:bg-slate-700 hover:text-slate-200` (mirror the owner-filter pills in ISATracker).

### Step 2 — FundManager.tsx

- Heading `text-gray-900` → `text-slate-100`; subtitle `text-gray-400` → `text-slate-500`.
- Empty state card `bg-white rounded-2xl border border-gray-100 … shadow-sm` →
  `bg-slate-800/70 rounded-xl border border-slate-700/50` (drop the shadow; dark cards
  in this app don't use shadows).
- Read the rest of the file (only the first 80 lines were quoted here — there is a
  `FundCard` component further down): apply the same table to every light class in it.
- Primary buttons `hover:bg-indigo-700` → `hover:bg-indigo-500`.

### Step 3 — FundUploadModal.tsx

- Replace the hand-rolled shell's classes to match `Modal.tsx`: overlay
  `fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm`,
  panel `bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`.
  (Do NOT refactor it to use the `Modal` component — it has a custom footer layout;
  class alignment is enough and keeps the diff reviewable.)
- Header border `border-gray-100` → `border-slate-700/60`; title → `text-slate-50`;
  close button hover `hover:bg-gray-100` → `hover:bg-slate-700`, icon `text-slate-500 hover:text-slate-300`.
- Green success panel, red error panel, amber "will replace" note, ticker input, top-5
  preview table, footer buttons: apply the table.
- Spinner `text-indigo-500` is fine on dark; `text-gray-500` next to it → `text-slate-400`.

### Step 4 — verify

Run the dev server (`.claude/launch.json` config `isa-fire-tracker`, port 5174), sign
in, and walk each screen (Portfolio → Import CSV, both steps of the wizard including a
parse error; settings menu → Fund Holdings as the admin account; upload modal in all
three states — idle, error, preview).

Then grep for stragglers — this must return nothing in the three files:

```
grep -nE "(bg-white|gray-[0-9]|red-50|green-50|emerald-50|indigo-50|amber-600)" src/components/CSVImportModal.tsx src/components/FundManager.tsx src/components/FundUploadModal.tsx
```

## Edge cases a weaker model would miss

- **The CSV preview step is only reachable with a valid CSV.** To test it without real
  broker data, craft a minimal Trading 212 CSV (headers:
  `Action,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Total,Currency (Total)`
  plus one `Market buy` row) — the parser matches columns by header name.
- **The error state needs deliberate triggering:** upload any non-matching CSV to see
  the red banner; don't skip styling it just because the happy path looks done.
- **`/funds` is admin-gated** (`VITE_ADMIN_EMAIL` in `.env.local` must equal the
  signed-in email, see `App.tsx` `isAdmin`). If the route redirects to `/`, that's the
  gate, not a bug.
- **Native `<select>`/`<option>` dark styling is inconsistent across browsers** —
  setting `bg-slate-900 text-slate-200` on the `<select>` itself (as `UserMenu` in
  App.tsx already does) is the proven pattern in this codebase; copy it exactly.
- **`FundUploadModal` has no `max-h`/scroll on its panel** — while aligning classes
  with Modal.tsx, include `max-h-[90vh] overflow-y-auto` so long previews don't
  overflow small screens.
- **Don't touch `truncate max-w-[140px]`/`max-w-36`, spacing, or layout classes** —
  color/border/background only. The diff should contain no structural JSX changes
  except the FundUploadModal shell classes.

## Acceptance criteria

1. `npm run build` and `npm run lint` pass.
2. The grep in step 4 returns zero matches across the three files.
3. Visual walkthrough on the dark background shows: no white panels, no dark-gray text
   on dark backgrounds, banners legible (red error, green success, amber warnings), and
   selects readable when opened (both closed and expanded states).
4. Every interactive element still works: broker/provider selects, drop zones (click
   and drag-over highlight), mode toggle, back/confirm buttons, fund upload
   parse→preview→save flow, fund delete.
5. Side-by-side eyeball check against `HoldingModal` (Add Holding): inputs, labels,
   and buttons in the restyled modals are visually indistinguishable in style.
