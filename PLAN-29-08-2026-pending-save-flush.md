# PLAN: Never lose the last edit — flush pending saves and replay a dirty cache (rank 2)

> **Do this after [PLAN-29-08-2026-sync-conflict-guard.md](PLAN-29-08-2026-sync-conflict-guard.md).**
> Both plans edit `src/App.tsx` and `src/lib/db.ts`, and this one assumes the `version`
> field that plan introduces. Executing them out of order will produce merge pain.

## Goal

Edits made in the last second before the tab closes are silently lost.

[`scheduleSave`](src/App.tsx:112) debounces for 1000 ms. There is no `pagehide` or
`visibilitychange` handler anywhere in the app, so if the user edits a holding and
immediately switches away or closes the tab, the timer never fires and the edit evaporates —
no error, no indication. This is worst exactly where the app is used most: iOS freezes and
reaps installed-PWA tabs aggressively when you switch apps.

Compounding it, [`cacheAppData`](src/lib/localCache.ts:7) is only called **after a successful
remote save** ([App.tsx:120](src/App.tsx:120)). So the localStorage cache never contains an
unsaved edit either — there is no local record from which to recover.

Two changes fix this properly:

1. **Flush on hide** — when the page is hidden or unloading, fire the pending save now
   instead of waiting out the debounce.
2. **Write-through dirty cache** — record every change to localStorage *immediately*, marked
   dirty, and replay it on next load if it never made it to the server.

## Files to touch

- [src/lib/localCache.ts](src/lib/localCache.ts) — cache entry gains `version` and `dirty`
- [src/App.tsx](src/App.tsx) — extract the save body, add the flush listeners, replay on load
- **New:** `src/lib/localCache.test.ts` — round-trip and legacy-shape tests

## Implementation order

### Step 1 — cache shape

Rewrite [src/lib/localCache.ts](src/lib/localCache.ts). Keep the existing per-user key
comment and the try/catch tolerance (quota exceeded / Safari private mode must never break
the app).

```ts
import type { AppData } from '../types';

// Keyed per user so two accounts on one device never see each other's cache.
const KEY = (userId: string) => `isa-fire:appdata:${userId}`;

export interface CachedEntry {
  data: AppData;
  /** Version the data is based on; null when the user had no remote row yet. */
  version: number | null;
  /** True when this copy has NOT been confirmed saved to Supabase. */
  dirty: boolean;
}

/** Best-effort cache of raw AppData (never the display copy). */
export function cacheAppData(userId: string, data: AppData, version: number | null, dirty: boolean): void {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify({ data, version, dirty } satisfies CachedEntry));
  } catch {
    // quota exceeded / private mode — the app must work without the cache
  }
}

export function readCachedAppData(userId: string): CachedEntry | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Pre-v2 caches stored bare AppData. Treat them as clean and version-less.
    if (parsed && typeof parsed === 'object' && 'providers' in parsed) {
      return { data: parsed as AppData, version: null, dirty: false };
    }
    return parsed as CachedEntry;
  } catch {
    return null;
  }
}
```

**Do not bump the storage key.** The legacy-shape branch above upgrades existing caches in
place; changing the key would strand the user's current offline copy.

### Step 2 — extract the save so it can be called from two places

In [App.tsx](src/App.tsx), pull the body of the debounced callback out into a reusable
function so both the timer and the flush handler use identical logic:

```ts
const runSave = useCallback(async (next: AppData) => {
  if (!user || degradedRef.current || conflictRef.current) return;
  if (savingRef.current) return;
  savingRef.current = true;
  setSyncState('syncing');
  try {
    const newVersion = await saveToSupabase(next, versionRef.current);
    versionRef.current = newVersion;
    cacheAppData(user.id, next, newVersion, false);   // clean
    setSyncState('idle');
  } catch (err) {
    if (err instanceof ConflictError) { conflictRef.current = true; setConflict(true); }
    setSyncState('error');
  } finally {
    savingRef.current = false;
  }
}, [user]);
```

`scheduleSave` becomes the debounce wrapper around it, and additionally keeps the payload
where the flush handler can find it:

```ts
const pendingRef = useRef<AppData | null>(null);

const scheduleSave = useCallback((next: AppData) => {
  if (!user || degradedRef.current || conflictRef.current) return;
  pendingRef.current = next;
  cacheAppData(user.id, next, versionRef.current, true);   // dirty, written synchronously
  if (saveTimer.current) clearTimeout(saveTimer.current);
  saveTimer.current = setTimeout(() => {
    saveTimer.current = null;
    const payload = pendingRef.current;
    pendingRef.current = null;
    if (payload) void runSave(payload);
  }, 1000);
}, [user, runSave]);
```

That `cacheAppData(..., dirty: true)` call is the whole safety net: it is synchronous and
runs on every keystroke-settled change, so even `kill -9` on the browser preserves the edit.

### Step 3 — flush on hide

Add an effect near the other lifecycle effects:

```ts
useEffect(() => {
  if (!user) return;
  const flush = () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const payload = pendingRef.current;
    pendingRef.current = null;
    if (payload) void runSave(payload);
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
  };
}, [user, runSave]);
```

### Step 4 — replay a dirty cache on load

In `loadData`'s success branch, after `versionRef.current` is set from the remote row:

```ts
const cached = readCachedAppData(u.id);
if (cached?.dirty && cached.version === (remote?.version ?? null)) {
  // The local copy is the remote row plus edits that never reached the server.
  baseData.current = migrateAppData(cached.data);
  setData(baseData.current);
  void runSave(baseData.current);
} else {
  // Remote moved on (another device) — the local dirty copy is not safely replayable.
  if (cached?.dirty) console.warn('Discarding a stale unsaved local copy');
  cacheAppData(u.id, loaded, versionRef.current, false);
}
```

The degraded (`.catch`) branch keeps reading the cache as it does today — just unwrap
`.data` from the new `CachedEntry` shape.

### Step 5 — tests

`src/lib/localCache.test.ts`, using a stubbed `localStorage` (`vi.stubGlobal`):

1. `cacheAppData` → `readCachedAppData` round-trips `data`, `version` and `dirty`.
2. A pre-v2 raw `AppData` value in storage reads back as
   `{ data, version: null, dirty: false }`.
3. Corrupt JSON returns `null` and does not throw.
4. A `setItem` that throws (simulated quota error) does not propagate.

## Edge cases a weaker model will miss

- **`pagehide` is the reliable one; `beforeunload` is not.** Do not use `beforeunload` —
  it is unreliable on mobile Safari and blocks the bfcache. Do not use
  `navigator.sendBeacon` either: PostgREST needs `apikey` and `Authorization` headers, and
  `sendBeacon` cannot set headers.
- **`visibilitychange` fires constantly** — on every tab switch, app switch and screen lock.
  The `if (!saveTimer.current) return;` early-out is what stops this becoming a write storm.
  Keep it.
- **Do not `await` inside the `pagehide` handler.** The page may be torn down mid-promise;
  fire and forget. The dirty cache from Step 2 is what actually guarantees durability, so a
  dropped in-flight request is recoverable on next load.
- **`runSave` must keep the `savingRef` mutex** introduced in the conflict-guard plan. A
  flush firing while a debounced save is already in flight would otherwise send two writes
  with the same `expectedVersion`, and the second would raise a spurious conflict.
- **Replay only when versions match.** If the remote version has moved, replaying the local
  dirty copy would reintroduce exactly the clobbering bug the conflict-guard plan just
  fixed. Discard and warn, as shown.
- **`migrateAppData` on replay.** A cached copy may predate a schema change — run it through
  `migrateAppData` (the degraded path at [App.tsx:96](src/App.tsx:96) already does this for
  the same reason).
- **StrictMode double-invokes effects in dev.** The listener effect must be
  add/remove-symmetric or you will register two flush handlers. The cleanup above is correct;
  do not drop it.

## Acceptance criteria

1. `npm run build` clean, `npm test` passes.
2. Edit a holding and close the tab within one second. Reopen: **the edit is present**, and
   Supabase's `version` has advanced. (Before this change, the edit is gone.)
3. Edit a holding, then immediately switch to another tab. Devtools Network shows the PATCH
   fire straight away rather than a second later.
4. Simulate offline: devtools → Network → Offline, make an edit, close the tab. Go back
   online and reload — the edit is replayed and saved (watch for the PATCH on load).
5. `localStorage` contains `{"data":…,"version":N,"dirty":false}` after a settled save, and
   `"dirty":true` in the instant between an edit and its save.
6. A user with a pre-existing (pre-v2) cache entry loads normally with no console errors.
