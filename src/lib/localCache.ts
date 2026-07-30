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

/**
 * Best-effort cache of the last known raw AppData (never the display copy).
 * Written synchronously on every change with dirty=true, so an edit survives the
 * tab being killed before its debounced save fires.
 */
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
    if (!parsed || typeof parsed !== 'object') return null;
    // Pre-versioning caches stored bare AppData under the same key. Upgrade in
    // place rather than bumping the key, which would strand the offline copy.
    if ('providers' in parsed) {
      return { data: parsed as AppData, version: null, dirty: false };
    }
    return parsed as CachedEntry;
  } catch {
    return null;
  }
}
