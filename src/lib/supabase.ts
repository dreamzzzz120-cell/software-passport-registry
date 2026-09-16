/** SPR Supabase browser client. Publishable keys are safe for browser use. Environment variables override the connected production project. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL || 'https://gezmtnleoyrudxztegoj.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_YXrFQ2Qr8M-CEYKZLIsbqQ_weZK--PR';
export const supabaseConfigured = Boolean(url && key);
let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase browser authentication is not configured.');
  if (!client) client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const supabase = new Proxy({} as SupabaseClient, { get(_target, property, receiver) { return Reflect.get(getClient(), property, receiver); } });

