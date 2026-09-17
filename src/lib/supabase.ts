/** SPR Supabase browser client. Publishable keys are safe for browser use. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Keep browser auth on the verified SPR production Supabase project. This prevents
// a stale/misconfigured VITE_SUPABASE_* value in a Vercel environment from
// replacing the production credentials and producing "Invalid API key" in the
// live signup/login screen.
const url = 'https://gezmtnleoyrudxztegoj.supabase.co';
const key = 'sb_publishable_MaRll_oRAt1JrrqLrd8M_g_DpFyhdkG';

export const supabaseConfigured = Boolean(url && key);
let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase browser authentication is not configured.');
  if (!client) client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const supabase = new Proxy({} as SupabaseClient, { get(_target, property, receiver) { return Reflect.get(getClient(), property, receiver); } });
