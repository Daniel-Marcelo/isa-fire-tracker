# Task 5 report: Holdings list

## Status

Implemented the Holdings list route in the `mobile-ux` worktree.

## Changes

- Added `src/components/HoldingsList.tsx`.
- Pointed `/holdings/*` at `HoldingsList`.
- Added exposure and add-account links.
- Added conditional owner/type filters with `All` first.
- Added whole-row account links with provider colour, metadata, value, and gain.
- Preserved the requested card order and visibility conditions.
- Left the legacy `ISATracker` component in place for Task 6.

## Verification

- `npm test`: 343 tests passed across 34 files.
- `npm run build`: passed.
- IDE lint diagnostics: none for changed files.

## Concerns

- `/holdings/new` and `/holdings/:id` intentionally remain future routes for Task 6.
- The legacy `ISATracker` implementation remains available but is no longer rendered by `/holdings/*`.

## Follow-up fix

- Removed the unused `ISATracker` import from `src/App.tsx`; `src/components/ISATracker.tsx` remains on disk for Task 6.
