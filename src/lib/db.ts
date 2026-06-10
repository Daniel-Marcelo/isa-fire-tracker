import type { AppData } from '../types';
import { supabase } from './supabase';

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
