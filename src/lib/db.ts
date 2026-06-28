import type { AppData, Holding, UploadedFundHoldings } from '../types';
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

  const appData = data.data as AppData;

  // Migrate old data: if a holding has no manualValue but has a stored currentValue,
  // treat it as the native-currency manual value.
  return {
    ...appData,
    providers: appData.providers.map(p => ({
      ...p,
      holdings: p.holdings.map(h => {
        if (h.manualValue == null && (h as any).currentValue != null) {
          return { ...h, manualValue: (h as any).currentValue, currentValue: undefined };
        }
        return h;
      }),
    })),
  };
}

function stripDerived(holding: Holding): Omit<Holding, 'currentPrice' | 'currentValue'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { currentPrice, currentValue, ...stored } = holding;
  return stored;
}

/** Upsert AppData to Supabase for the signed-in user. */
export async function saveToSupabase(appData: AppData): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const cleaned: AppData = {
    ...appData,
    providers: appData.providers.map(p => ({
      ...p,
      holdings: p.holdings.map(stripDerived) as Holding[],
    })),
  };

  const { error } = await supabase
    .from(TABLE)
    .upsert({ user_id: user.id, data: cleaned, updated_at: new Date().toISOString() });

  if (error) throw error;
}
