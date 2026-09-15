/**
 * SPR Supabase browser client.
 *
 * Configuration is supplied by the deployment environment. A missing key must
 * not crash the application during module initialization; callers receive a
 * clear configuration error instead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const supabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase browser authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the deployment environment.');
  }
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

// Lazy proxy keeps the existing `supabase.auth.*` call sites while ensuring
// test/build environments without browser credentials can still load modules.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
});
