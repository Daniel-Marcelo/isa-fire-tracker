import type { AppData, UploadedFundHoldings } from '../types';
import { supabase } from './supabase';
import { migrateAppData, stripDerived } from '../store';

const FUND_TABLE = 'fund_holdings';

export async function loadFundHoldings(): Promise<UploadedFundHoldings[]> {
  const { data, error } = await supabase
    .from(FUND_TABLE)
    .select('fund_ticker, fund_name, as_at, uploaded_at, holdings')
    .order('fund_ticker');
  if (error) {
    console.warn('Failed to load fund holdings:', error.message);
    return [];
  }
  return (data ?? []).map(r => ({
    fundTicker: r.fund_ticker,
    fundName: r.fund_name,
    asAt: r.as_at,
    uploadedAt: r.uploaded_at,
    holdings: r.holdings,
  })) as UploadedFundHoldings[];
}

export async function saveFundHolding(holding: UploadedFundHoldings): Promise<void> {
  const { error } = await supabase
    .from(FUND_TABLE)
    .upsert({
      fund_ticker: holding.fundTicker,
      fund_name: holding.fundName,
      as_at: holding.asAt,
      uploaded_at: holding.uploadedAt,
      holdings: holding.holdings,
    });
  if (error) throw error;
}

export async function deleteFundHolding(fundTicker: string): Promise<void> {
  const { error } = await supabase
    .from(FUND_TABLE)
    .delete()
    .eq('fund_ticker', fundTicker);
  if (error) throw error;
}

const TABLE = 'user_data';

export interface LoadedAppData {
  data: AppData;
  /** Optimistic-lock counter the data was read at. */
  version: number;
}

/**
 * Thrown when the remote row moved on since we loaded it — i.e. another device
 * saved in between. The caller must stop writing and reload; auto-merging a blob
 * whose arrays are keyed by generated uids would duplicate providers.
 */
export class ConflictError extends Error {
  constructor() {
    super('This portfolio was changed on another device');
    this.name = 'ConflictError';
  }
}

/** Load AppData + its version. Returns null if no row yet. */
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
 * Pass null when the user has no row yet (first ever save). Returns the new version.
 */
export async function saveToSupabase(appData: AppData, expectedVersion: number | null): Promise<number> {
  // getSession() reads the local session; getUser() would be a network round trip
  // on every single save.
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
  // Zero rows means the version guard matched nothing (or RLS denied) — either way
  // someone else owns the current state and we must not overwrite it.
  if (!data || data.length === 0) throw new ConflictError();
  return Number(data[0].version);
}
