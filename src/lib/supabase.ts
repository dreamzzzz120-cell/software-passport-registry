/** SPR Supabase browser client. Publishable keys are safe for browser use. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import './authRecovery';

// The project URL and publishable key are inlined at build time by
// vite.config.ts from VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY, which
// the deploy platforms (Vercel for the SPA, Railway for the image that serves
// the SPA shell) own. They used to be hard-coded here as a workaround for those
// variables never having been set in Vercel; that pinned a Supabase project in
// source, which is exactly the drift the platform variables exist to prevent.
// SPR_REQUIRE_SUPABASE_CONFIG=true makes a build without them fail instead of
// shipping a bundle whose login screen cannot work.
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

export const supabaseConfigured = Boolean(url && key);
let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase browser authentication is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY were absent at build time.');
  if (!client) client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const supabase = new Proxy({} as SupabaseClient, { get(_target, property, receiver) { return Reflect.get(getClient(), property, receiver); } });
