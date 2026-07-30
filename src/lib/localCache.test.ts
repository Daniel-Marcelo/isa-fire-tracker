import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cacheAppData, readCachedAppData } from './localCache';
import { defaultData } from '../store';
import type { AppData } from '../types';

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}

const KEY = 'isa-fire:appdata:user-1';

describe('localCache', () => {
  let store: Map<string, string>;
  beforeEach(() => { store = stubStorage(); });

  it('round-trips data, version and the dirty flag', () => {
    cacheAppData('user-1', defaultData, 7, true);
    const entry = readCachedAppData('user-1');
    expect(entry?.version).toBe(7);
    expect(entry?.dirty).toBe(true);
    expect(entry?.data.providers).toEqual([]);
  });

  it('keeps a null version (no remote row yet) distinct from version 0', () => {
    cacheAppData('user-1', defaultData, null, false);
    expect(readCachedAppData('user-1')?.version).toBeNull();
  });

  it('is keyed per user so two accounts on one device never collide', () => {
    cacheAppData('user-1', defaultData, 1, false);
    expect(readCachedAppData('user-2')).toBeNull();
  });

  it('upgrades a pre-versioning cache entry (bare AppData) in place', () => {
    // Written by an older build under the same key — must not be discarded.
    const legacy: AppData = { ...defaultData, taxYear: 2024 };
    store.set(KEY, JSON.stringify(legacy));
    const entry = readCachedAppData('user-1');
    expect(entry?.data.taxYear).toBe(2024);
    expect(entry?.version).toBeNull();
    // Treated as clean: an old cache can't be proven to hold unsaved edits, and
    // replaying it blindly could resurrect stale data.
    expect(entry?.dirty).toBe(false);
  });

  it('returns null on corrupt JSON instead of throwing', () => {
    store.set(KEY, '{not json');
    expect(readCachedAppData('user-1')).toBeNull();
  });

  it('returns null when nothing is cached', () => {
    expect(readCachedAppData('user-1')).toBeNull();
  });

  it('swallows a quota-exceeded write so the app keeps working without a cache', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(() => cacheAppData('user-1', defaultData, 1, true)).not.toThrow();
  });
});
