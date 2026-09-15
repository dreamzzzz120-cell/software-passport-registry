/**
 * Legacy compatibility name retained while SPR moves authentication to Supabase.
 * No Firebase SDK or Firebase credentials are used here.
 *
 * Existing routes call adminAuth.verifyIdToken(). We keep that narrow interface
 * so the migration can be deployed without rewriting every route at once.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kfpjjyrwzupiyhzjpbqo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_YXrFQ2Qr8M-CEYKZLIsbqQ_weZK--PR';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const adminAuth = {
  async verifyIdToken(token: string) {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      const err = new Error('Invalid or expired Supabase access token') as Error & { code?: string };
      err.code = 'auth/invalid-id-token';
      throw err;
    }
    return {
      uid: data.user.id,
      email: data.user.email ?? undefined,
      email_verified: Boolean(data.user.email_confirmed_at),
      user_metadata: data.user.user_metadata ?? {},
      app_metadata: data.user.app_metadata ?? {},
      aud: 'authenticated',
    };
  },
};

// Supabase stores authorization in its database/RLS model. SPR's backend also
// re-reads role and tenant from its users table on every authenticated request,
// so Firebase-style custom claims are intentionally not required.
export async function setUserCustomClaims(_uid: string, _claims: Record<string, unknown>) {
  return undefined;
}

export async function ensureFirebaseAuthorizedDomain(_domain: string) {
  return undefined;
}

export async function removeFirebaseAuthorizedDomain(_domain: string) {
  return undefined;
}
