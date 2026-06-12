import type { AppData, UploadedFundHoldings } from '../types';
import { supabase } from './supabase';

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

/** Load AppData from Supabase for the signed-in user. Returns null if no row yet. */
export async function loadFromSupabase(): Promise<AppData | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows — first time
    throw error;
  }
  return data.data as AppData;
}

/** Upsert AppData to Supabase for the signed-in user. */
export async function saveToSupabase(appData: AppData): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from(TABLE)
    .upsert({ user_id: user.id, data: appData, updated_at: new Date().toISOString() });

  if (error) throw error;
}
