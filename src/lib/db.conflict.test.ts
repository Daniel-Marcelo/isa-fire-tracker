import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultData } from '../store';

interface Result { data: unknown; error: unknown }

// vi.hoisted: the vi.mock factory runs during the (hoisted) import of ./db, which
// is before any top-level const in this file would have initialised.
const h = vi.hoisted(() => {
  const state = {
    op: 'select' as 'select' | 'insert' | 'update',
    payload: null as Record<string, unknown> | null,
    filters: [] as [string, unknown][],
  };
  const results: Record<string, { data: unknown; error: unknown }> = {
    select: { data: { data: { providers: [] }, version: 3 }, error: null },
    insert: { data: { version: 1 }, error: null },
    update: { data: [{ version: 6 }], error: null },
  };
  return { state, results };
});

vi.mock('./supabase', () => {
  const makeBuilder = () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      insert: (payload: Record<string, unknown>) => { h.state.op = 'insert'; h.state.payload = payload; return b; },
      update: (payload: Record<string, unknown>) => { h.state.op = 'update'; h.state.payload = payload; return b; },
      eq: (col: string, val: unknown) => { h.state.filters.push([col, val]); return b; },
      single: async () => h.results[h.state.op],
      // Awaiting the builder itself (the .update(...).eq(...).select(...) chain).
      then: (ok: (r: Result) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(h.results[h.state.op] as Result).then(ok, err),
    });
    return b;
  };
  return {
    supabase: {
      from: () => { h.state.op = 'select'; h.state.payload = null; h.state.filters = []; return makeBuilder(); },
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
    },
  };
});

const { loadFromSupabase, saveToSupabase, ConflictError } = await import('./db');

describe('optimistic concurrency', () => {
  beforeEach(() => {
    h.state.op = 'select';
    h.state.payload = null;
    h.state.filters = [];
    h.results.select = { data: { data: { providers: [] }, version: 3 }, error: null };
    h.results.insert = { data: { version: 1 }, error: null };
    h.results.update = { data: [{ version: 6 }], error: null };
  });

  it('loads the version alongside the data', async () => {
    const loaded = await loadFromSupabase();
    expect(loaded?.version).toBe(3);
    expect(loaded?.data.providers).toEqual([]);
  });

  it('returns null (not an error) when the user has no row yet', async () => {
    h.results.select = { data: null, error: { code: 'PGRST116' } };
    expect(await loadFromSupabase()).toBeNull();
  });

  it('guards the update on the loaded version and writes version + 1', async () => {
    const newVersion = await saveToSupabase(defaultData, 5);
    expect(h.state.op).toBe('update');
    expect(h.state.payload?.version).toBe(6);
    expect(h.state.filters).toContainEqual(['version', 5]);
    expect(h.state.filters).toContainEqual(['user_id', 'user-1']);
    expect(newVersion).toBe(6);
  });

  it('throws ConflictError when the version guard matches no rows', async () => {
    h.results.update = { data: [], error: null };
    await expect(saveToSupabase(defaultData, 5)).rejects.toBeInstanceOf(ConflictError);
  });

  it('inserts at version 1 when there is no row yet', async () => {
    const newVersion = await saveToSupabase(defaultData, null);
    expect(h.state.op).toBe('insert');
    expect(h.state.payload?.version).toBe(1);
    // A null expectedVersion must NOT become `.eq('version', null)`, which would
    // match nothing and give every new user a permanent false conflict.
    expect(h.state.filters).toEqual([]);
    expect(newVersion).toBe(1);
  });

  it('treats a unique violation on insert as a conflict, not a raw error', async () => {
    h.results.insert = { data: null, error: { code: '23505' } };
    await expect(saveToSupabase(defaultData, null)).rejects.toBeInstanceOf(ConflictError);
  });

  it('propagates a genuine transport error rather than calling it a conflict', async () => {
    h.results.update = { data: null, error: { code: '08006', message: 'connection failure' } };
    await expect(saveToSupabase(defaultData, 5)).rejects.not.toBeInstanceOf(ConflictError);
  });

  it('strips runtime-derived fields before writing', async () => {
    const withDerived = {
      ...defaultData,
      providers: [{
        id: 'p1', name: 'Test', color: '#fff', snapshots: [],
        holdings: [{ id: 'h1', name: 'X', units: 1, manualValue: 10, currentPrice: 99, currentValue: 99 }],
      }],
    };
    await saveToSupabase(withDerived, 1);
    const written = (h.state.payload?.data as typeof withDerived).providers[0].holdings[0];
    expect(written).not.toHaveProperty('currentPrice');
    expect(written).not.toHaveProperty('currentValue');
    expect(written).toHaveProperty('manualValue', 10);
  });
});
