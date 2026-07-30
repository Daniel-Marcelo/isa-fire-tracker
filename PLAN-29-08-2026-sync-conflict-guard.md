# PLAN: Optimistic-concurrency guard on Supabase writes (rank 1)

## Goal

Right now two devices editing the same account **silently destroy each other's data**.

[`saveToSupabase`](src/lib/db.ts:64) does a blind `upsert` of the *entire* `AppData` blob,
and [`loadFromSupabase`](src/lib/db.ts:49) never reads `updated_at`. There is no version,
no guard, no conflict detection. The sequence that loses data:

1. Desktop loads the portfolio at 09:00.
2. Phone loads the same portfolio at 09:05, adds a holding, saves.
3. Desktop (still holding the 09:00 snapshot in `baseData.current`) edits anything at 09:10
   — the 1 s debounce in [`scheduleSave`](src/App.tsx:112) fires and writes the **whole
   09:00 blob** over the phone's work. The phone's holding is gone, with no error shown on
   either device.

This is not theoretical: a React Native port lives in the sibling folder
`../isa-fire-mobile` and reads the same `user_data` row.

Add a `version` column and refuse writes whose base version is stale, then surface the
conflict in the UI with a Reload action.

**Why a `version` integer and not `updated_at`:** guarding on a `timestamptz` means
round-tripping an ISO string through PostgREST and matching it exactly in a `.eq()` filter
— millisecond-vs-microsecond precision and `+00:00` URL encoding make that fragile. A
monotonically increasing `bigint` has none of those problems.

## Files to touch

- **Supabase schema** — new `version` column (apply via the Supabase MCP server, per
  [CLAUDE.md](CLAUDE.md); fall back to the dashboard SQL editor if the MCP is unavailable)
- [supabase-schema.sql](supabase-schema.sql) — record the column so the file stays the
  source of truth
- [src/lib/db.ts](src/lib/db.ts) — return the version on load, guard on save, throw a typed
  `ConflictError`
- [src/App.tsx](src/App.tsx) — hold the version in a ref, serialise saves, render a
  conflict banner
- **New:** `src/lib/db.conflict.test.ts` — unit-test the conflict detection with a mocked
  supabase client

## Implementation order

### Step 1 — schema

Apply this migration:

```sql
alter table public.user_data
  add column if not exists version bigint not null default 1;
```

Then append the same statement to [supabase-schema.sql](supabase-schema.sql) under the
`user_data` table definition, with a short comment explaining it is the optimistic-lock
counter. The existing RLS policies already cover `select` / `insert` / `update` and need no
change.

### Step 2 — `db.ts`

Replace the current load/save pair. Keep `stripDerived` and `migrateAppData` exactly where
they are — they are load/save hygiene and are separately tested.

```ts
export interface LoadedAppData {
  data: AppData;
  version: number;
}

/** Thrown when the remote row moved on since we loaded it. */
export class ConflictError extends Error {
  constructor() {
    super('This portfolio was changed on another device');
    this.name = 'ConflictError';
  }
}

/** Load AppData + its version. Returns null if the user has no row yet. */
export async function loadFromSupabase(): Promise<LoadedAppData | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data, version')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows — first time
    throw error;
  }

  return {
    data: migrateAppData(data.data as AppData),
    version: Number(data.version ?? 1),
  };
}

/**
 * Write AppData, refusing to clobber a row that changed since `expectedVersion`.
 * Pass `null` as expectedVersion when the user has no row yet (first ever save).
 * Returns the new version. Throws ConflictError if the guard failed.
 */
export async function saveToSupabase(
  appData: AppData,
  expectedVersion: number | null,
): Promise<number> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not signed in');

  const cleaned: AppData = {
    ...appData,
    providers: appData.providers.map(p => ({
      ...p,
      holdings: p.holdings.map(stripDerived),
    })),
  };

  if (expectedVersion === null) {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ user_id: user.id, data: cleaned, version: 1, updated_at: new Date().toISOString() })
      .select('version')
      .single();
    // 23505 = unique violation: a row appeared between our load and this insert.
    if (error) throw error.code === '23505' ? new ConflictError() : error;
    return Number(data.version);
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      data: cleaned,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('version', expectedVersion)
    .select('version');

  if (error) throw error;
  if (!data || data.length === 0) throw new ConflictError();
  return Number(data[0].version);
}
```

**Note the `getSession()` swap:** the old code called `supabase.auth.getUser()`, which is a
*network* round trip on every single save. `getSession()` reads the local session. Keep this
change — it is a free latency win.

### Step 3 — `App.tsx`

Add alongside the existing refs (near [App.tsx:41](src/App.tsx:41)):

```ts
const versionRef = useRef<number | null>(null);
const savingRef = useRef(false);
const [conflict, setConflict] = useState(false);
```

**`loadData`** ([App.tsx:76](src/App.tsx:76)) — `loadFromSupabase()` now returns
`LoadedAppData | null`, so unpack it:

```ts
Promise.all([loadFromSupabase(), loadFundHoldings()])
  .then(([remote, funds]) => {
    const loaded = remote?.data ?? defaultData;
    versionRef.current = remote?.version ?? null;   // null = no row yet
    setConflict(false);
    // ...rest unchanged (baseData.current, setData, cacheAppData, etc.)
  })
```

In the `.catch` branch (degraded mode) set `versionRef.current = null` **and** leave
`degradedRef.current = true` — the existing degraded guard already blocks saves, so a null
version can never be mistaken for "no row, safe to insert".

**`scheduleSave`** ([App.tsx:112](src/App.tsx:112)) — serialise, and handle the conflict:

```ts
const scheduleSave = useCallback((next: AppData) => {
  if (!user) return;
  if (degradedRef.current) return;
  if (conflictRef.current) return;              // never write after a conflict
  if (saveTimer.current) clearTimeout(saveTimer.current);
  saveTimer.current = setTimeout(() => {
    // A save is already in flight; re-arm rather than racing it with a stale version.
    if (savingRef.current) { scheduleSave(next); return; }
    savingRef.current = true;
    setSyncState('syncing');
    saveToSupabase(next, versionRef.current)
      .then(newVersion => {
        versionRef.current = newVersion;
        cacheAppData(user.id, next);
        setSyncState('idle');
      })
      .catch(err => {
        if (err instanceof ConflictError) {
          conflictRef.current = true;
          setConflict(true);
        }
        setSyncState('error');
      })
      .finally(() => { savingRef.current = false; });
  }, 1000);
}, [user]);
```

Mirror the existing `degradedRef` pattern for `conflict` — a `conflictRef` plus a
`setConflictMode(v)` callback that writes both, because `scheduleSave` closes over stale
state (this is exactly why `degradedRef` already exists; see the comment at
[App.tsx:47](src/App.tsx:47)).

**Banner** — copy the shape of the existing degraded banner at
[App.tsx:278](src/App.tsx:278), but in red rather than amber, and non-dismissable:

```tsx
{conflict && (
  <div className="max-w-5xl mx-auto px-4 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-red-900/30 border border-red-800/40 rounded-xl px-4 py-2.5">
      <span className="text-sm text-red-300">
        This portfolio was changed on another device — your edits here aren't being saved.
      </span>
      <button
        onClick={() => loadData(user)}
        className="text-sm font-medium text-red-200 border border-red-700/60 rounded-lg px-3 py-1 hover:bg-red-900/40 transition-colors"
      >
        Reload
      </button>
    </div>
  </div>
)}
```

Stick to the palette in [CLAUDE.md](CLAUDE.md) — `red-400`/`red-900` are already the app's
loss/danger colours, so this is consistent, not a new hue.

### Step 4 — test

Create `src/lib/db.conflict.test.ts`. Mock the supabase module with `vi.mock('./supabase')`
and assert:

1. `saveToSupabase(data, 5)` issues an update filtered on `version === 5` and writes
   `version: 6`.
2. When the mocked update resolves `{ data: [], error: null }` (guard matched nothing),
   `saveToSupabase` rejects with `ConflictError`.
3. `saveToSupabase(data, null)` issues an insert with `version: 1`.
4. A `23505` error on the insert path becomes a `ConflictError`, not a raw throw.

Follow the mocking style already used in
[src/lib/firebasePrices.test.ts](src/lib/firebasePrices.test.ts) (that file stubs
`global.fetch`; here you stub the supabase client object instead).

## Edge cases a weaker model will miss

- **`refreshLivePrices` also saves.** [App.tsx:141-145](src/App.tsx:141) calls
  `scheduleSave(snapped)` when a new daily snapshot is written. That path must go through
  the *same* version guard, and a conflict there must not be swallowed — it is often the
  first write of a session and therefore the first place a conflict surfaces. Do not add a
  separate save path for it.
- **The first-ever save has no row.** `expectedVersion === null` must take the insert path.
  If you send `.eq('version', null)` you match nothing and every new user gets a permanent
  false conflict.
- **`.select()` returning `[]` after an update is also what RLS denial looks like.** Both
  cases are correctly handled as "stop writing and reload", so do not try to distinguish
  them — but do *not* treat a `null` `data` with a non-null `error` as a conflict; that is a
  genuine transport error and belongs in the existing `syncState === 'error'` path.
- **Do not auto-merge.** Tempting, but `AppData` is a deep blob with arrays keyed by
  generated `uid()`s; a naive merge will duplicate providers. Reload-and-lose-local-edits is
  the correct, honest behaviour here. Say so in the banner (it does).
- **Version must be a `number` in TS.** PostgREST returns `bigint` as a JS number for small
  values but can hand back a string; wrap every read in `Number(...)` as shown.
- **`loadedForUser` guard.** [App.tsx:105-110](src/App.tsx:105) prevents a reload for the
  same user id. The banner's Reload button calls `loadData(user)` directly, bypassing that
  effect, which is correct — do not "fix" it by touching `loadedForUser.current`.

## Acceptance criteria

1. `npm run build` is clean and `npm test` passes (project rule in [CLAUDE.md](CLAUDE.md):
   the build must pass before any commit — Vercel fails deploys on TS errors that
   `npm run dev` tolerates).
2. `select version from public.user_data;` returns a row with a version that **increments by
   one** on each save. Confirm by editing a holding twice and re-querying.
3. Two-browser test: open the app in two windows, edit and save in window A, then edit in
   window B. Window B shows the red conflict banner, its `syncState` goes to error, and
   **the row in Supabase still contains window A's data**. Clicking Reload in B pulls A's
   data and clears the banner.
4. After a conflict, further edits in window B do **not** produce any write (verify: the
   version in Supabase does not move).
5. A brand-new user (delete your row, reload) saves successfully via the insert path and
   ends up at `version = 1`.
6. Normal single-device use is unchanged: no banner, saves settle to the `idle` sync state.
