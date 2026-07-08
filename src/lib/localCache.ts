import type { AppData } from '../types';

// Keyed per user so two accounts on one device never see each other's cache.
const KEY = (userId: string) => `isa-fire:appdata:${userId}`;

/** Best-effort cache of the last known-good raw AppData (never the display copy). */
export function cacheAppData(userId: string, data: AppData): void {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(data));
  } catch {
    // quota exceeded / private mode — the app must work without the cache
  }
}

export function readCachedAppData(userId: string): AppData | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch {
    return null;
  }
}
