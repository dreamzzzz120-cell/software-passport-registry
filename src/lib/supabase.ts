/**
 * SPR Supabase browser client.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://kfpjjyrwzupiyhzjpbqo.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_YXrFQ2Qr8M-CEYKZLIsbqQ_weZK--PR';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const supabaseConfigured = Boolean(url && key);
