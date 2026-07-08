# PLAN: PWA Install + Offline Resilience (rank 5)

## Goal

The app already has a mobile-first UI (bottom tab bar, safe-area padding, apple-touch
icon) but isn't installable and dies without a network. Two deliverables:

1. **Installable PWA**: web manifest + service worker (precached app shell) via
   `vite-plugin-pwa`, so it lives on the home screen like a native app.
2. **Offline/failure resilience for data**: cache the last-known-good `AppData` in
   `localStorage` per user and fall back to it when the Supabase load fails. This
   fixes a real bug that exists today, network aside: in
   [src/App.tsx](src/App.tsx) the load effect's `.catch` does
   `setData(defaultData); setDataReady(true);` — **any transient load failure renders
   an empty portfolio**, and if the user then makes any edit, `handleChange` +
   `scheduleSave` will upsert that near-empty state over their real data in Supabase.
   The cache fallback plus a read-only guard closes that data-loss window.

## Files to touch

- [package.json](package.json) — add `vite-plugin-pwa` (devDependency)
- [vite.config.ts](vite.config.ts) — plugin config
- [index.html](index.html) — title, `theme-color`, iOS meta
- **New:** `public/pwa-192.png`, `public/pwa-512.png` (generated)
- **New:** `src/lib/localCache.ts`
- [src/App.tsx](src/App.tsx) — cache write/read, degraded-mode state + banner

## Implementation order

### Step 1 — offline data cache (do this first; it's the valuable half)

New `src/lib/localCache.ts`:

```ts
import type { AppData } from '../types';

const KEY = (userId: string) => `isa-fire:appdata:${userId}`;

export function cacheAppData(userId: string, data: AppData): void {
  try { localStorage.setItem(KEY(userId), JSON.stringify(data)); } catch { /* quota/private mode */ }
}

export function readCachedAppData(userId: string): AppData | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch { return null; }
}
```

In `App.tsx`:

- Add state: `const [degraded, setDegraded] = useState(false);` (true = showing
  cached data, saves disabled).
- In the load effect's `.then`: after `baseData.current = loaded`, call
  `cacheAppData(user.id, loaded)` and `setDegraded(false)`.
- In the `.catch`: run the cached data through `migrateAppData` (import from
  `./store`) — the cache may predate a schema change:

  ```ts
  .catch(() => {
    const cached = readCachedAppData(user.id);
    if (cached) {
      const migrated = migrateAppData(cached);
      baseData.current = migrated;
      setData(migrated);
      setDegraded(true);
    } else {
      setData(defaultData);
      setDegraded(true);       // even with no cache: block saves over unknown remote state
    }
    setSyncState('error');
    setDataReady(true);
  });
  ```

- **Write guard**: at the top of `scheduleSave`, add `if (degraded) return;` —
  `degraded` must be read via a ref (`const degradedRef = useRef(false)` kept in sync)
  or added to the `useCallback` deps; the existing callback has `[user]` deps only and
  would close over a stale `false`. This is the data-loss fix.
- Also update the *cache on save*: in `scheduleSave`'s `.then(() => setSyncState('idle'))`,
  add `cacheAppData(user.id, next)` so the cache tracks edits, not just loads.
  (`user` is in scope; `next` is the raw native-currency data — correct thing to cache.
  Never cache the display `data` state.)
- **Retry path**: when degraded, render a banner under the header (inside the
  max-width container, above `<main>`'s routes or at the top of it):
  amber style (`bg-amber-900/30 border border-amber-800/40 text-amber-300 text-sm rounded-xl px-4 py-2.5`),
  text "Couldn't reach the server — showing your last synced data (read-only)." with a
  "Retry" button that clears `loadedForUser.current = null` and re-triggers the load
  effect (simplest: extract the load logic into a `loadData(user)` function called by
  both the effect and the button).

### Step 2 — PWA plugin

`npm i -D vite-plugin-pwa` then in `vite.config.ts`:

```ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons.svg'],
      manifest: {
        name: 'ISA & FIRE Tracker',
        short_name: 'ISA & FIRE',
        description: 'Track ISA/SIPP portfolios and FIRE progress',
        theme_color: '#02061a',
        background_color: '#02061a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/assets\//],
        runtimeCaching: [
          // Never cache data/auth APIs — stale finance data is worse than none,
          // and the app has its own localStorage fallback (step 1).
          { urlPattern: /supabase\.co/, handler: 'NetworkOnly' },
          { urlPattern: /firestore\.googleapis\.com/, handler: 'NetworkOnly' },
          { urlPattern: /frankfurter\.dev/, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
});
```

Generate the two PNGs from the existing vector icon:
`npx @vite-pwa/assets-generator --preset minimal-2023 public/favicon.svg` produces the
standard set — or, simpler and dependency-free, render `public/favicon.svg` at 192/512
with any available tool and save as `public/pwa-192.png` / `public/pwa-512.png`. Verify
both files exist and are PNG (Chrome refuses to install without real 192+512 PNGs;
SVG-only manifests don't satisfy installability).

### Step 3 — index.html polish

- `<title>ISA & FIRE</title>` (currently the template default `isa-fire-tracker`).
- Add `<meta name="theme-color" content="#02061a" />`.
- Add `<meta name="apple-mobile-web-app-capable" content="yes" />` and
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
  (iOS ignores most of the manifest; these make the installed app edge-to-edge —
  the layout already handles `env(safe-area-inset-bottom)`).

### Step 4 — verify the service worker doesn't break auth

Supabase magic-link/OAuth redirects land on the app origin with tokens in the URL
hash; `navigateFallback` serves `index.html` for them, which is correct (hash is
client-side). Email+password (the current `AuthScreen`) doesn't redirect at all. No SW
exclusions needed beyond the `NetworkOnly` API rules — but confirm login works in the
built app (step 5), because a `CacheFirst` mistake on `supabase.co` would serve stale
auth responses and be miserable to debug.

## Edge cases a weaker model would miss

- **The stale-closure on `degraded`** in `scheduleSave` (step 1) — guard via ref or
  deps, or the read-only mode silently doesn't work and the data-loss bug survives.
- **Cache must store raw data, not display data**: caching the `data` state would
  persist display-converted `costBasis` (the same corruption class the other plans
  fight). Cache `loaded` / `next` (both are raw).
- **Run the cache through `migrateAppData` on read** — a cached blob written before a
  future schema change must not crash the app; `migrateAppData` is idempotent.
- **Degraded even with no cache**: the empty-portfolio + allowed-saves combination is
  today's overwrite hazard; blocking saves whenever the load failed (not only when
  cache was used) is the actual fix.
- **Per-user cache key**: two accounts on one device (this app literally has
  Daniel + Camilla owners) must not see each other's cached portfolio; key by
  `user.id` and never fall back across keys.
- **Service worker in dev**: leave `devOptions` unset (disabled). Test with
  `npm run build && npm run preview` — testing SW behaviour on the Vite dev server
  produces confusing half-cached states.
- **Update flow**: `registerType: 'autoUpdate'` means a new deploy takes effect on
  the next visit's reload; don't add a "new version" toast in v1, but *do* keep
  `navigateFallbackDenylist` for `/assets/` so hashed chunks 404 loudly instead of
  being masked by index.html (which breaks lazy loading in stale clients).
- **localStorage quota / Safari private mode** throws on `setItem` — hence the
  try/catch in `localCache.ts`; the app must work with caching unavailable.
- **Live prices while degraded**: `refreshLivePrices` runs on `dataReady` regardless;
  offline it rejects — there's a known missing `catch` there (see
  PLAN-snapshot-accuracy.md). If that plan hasn't landed, add `.catch(() => {})` at
  the two call sites (mount effect + interval) as part of this plan; offline the app
  should quietly show manual values.

## Acceptance criteria

1. `npm run build` passes; `dist/` contains `manifest.webmanifest`, `sw.js`,
   `pwa-192.png`, `pwa-512.png`.
2. `npm run preview` → Chrome DevTools → Application → Manifest shows no
   installability errors; the install prompt is available.
3. Lighthouse PWA audit (on the preview build) passes installability.
4. **Offline flow**: log in online, load data, then DevTools → Network → Offline →
   reload: the portfolio renders from cache with the amber read-only banner; edit
   buttons still open modals but saving is inert (no sync-error spam, and — key —
   go back online, reload, and the Supabase data is exactly what it was before the
   offline session).
5. **Transient-failure flow** (the pre-existing bug): with the SW unregistered, block
   only the `supabase.co` domain, reload — you get cached data + banner instead of an
   empty portfolio; clicking Retry after unblocking loads live data and clears the
   banner.
6. Login and logout still work in the built app with the SW active.
7. App title shows "ISA & FIRE" in the tab and on the installed icon; status bar area
   on an installed iOS device is dark, not white.
