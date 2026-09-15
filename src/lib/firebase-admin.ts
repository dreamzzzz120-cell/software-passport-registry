/**
 * Legacy compatibility module while SPR moves authentication to Supabase.
 * The active authentication provider is Supabase; no Firebase SDK or Firebase
 * credentials are used here. Existing routes can keep their Firebase-shaped
 * calls while the implementation delegates to Supabase Admin APIs.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kfpjjyrwzupiyhzjpbqo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function requireAdminKey() {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for administrative authentication operations');
}

export const adminAuth = {
  async verifyIdToken(token: string, _checkRevoked = false) {
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

  async listUsers(perPage = 1000) {
    requireAdminKey();
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage });
    if (error) throw error;
    return data.users;
  },

  async getUserByEmail(email: string) {
    requireAdminKey();
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
      if (user) return { uid: user.id, email: user.email, emailVerified: Boolean(user.email_confirmed_at) };
      if (data.users.length < perPage) break;
      page += 1;
    }
    const err = new Error('User not found') as Error & { code?: string };
    err.code = 'auth/user-not-found';
    throw err;
  },

  async createUser(input: { email: string; password?: string; emailVerified?: boolean; displayName?: string; disabled?: boolean }) {
    requireAdminKey();
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: input.emailVerified,
      user_metadata: input.displayName ? { full_name: input.displayName, displayName: input.displayName } : undefined,
    });
    if (error || !data.user) throw error || new Error('Unable to create Supabase user');
    if (input.disabled !== undefined) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { ban_duration: input.disabled ? '876000h' : 'none' });
      if (updateError) throw updateError;
    }
    return { uid: data.user.id, email: data.user.email, emailVerified: Boolean(data.user.email_confirmed_at) };
  },

  async generatePasswordResetLink(email: string) {
    requireAdminKey();
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
    if (error || !data.properties?.action_link) throw error || new Error('Unable to generate password reset link');
    return data.properties.action_link;
  },

  async generateEmailVerificationLink(email: string) {
    requireAdminKey();
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.action_link) throw error || new Error('Unable to generate email verification link');
    return data.properties.action_link;
  },

  async updateUser(uid: string, input: { disabled?: boolean }) {
    requireAdminKey();
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, { ban_duration: input.disabled ? '876000h' : 'none' });
    if (error || !data.user) throw error || new Error('Unable to update Supabase user');
    return { uid: data.user.id, email: data.user.email };
  },

  async revokeRefreshTokens(_uid: string) { return undefined; },

  async deleteUser(uid: string) {
    requireAdminKey();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw error;
    return undefined;
  },

  async setCustomUserClaims(_uid: string, _claims: Record<string, unknown>) { return undefined; },
};

export async function setUserCustomClaims(_uid: string, _claims: Record<string, unknown>) { return undefined; }
export async function ensureFirebaseAuthorizedDomain(_domain: string) { return undefined; }
export async function removeFirebaseAuthorizedDomain(_domain: string) { return undefined; }
export const addAuthorizedDomain = ensureFirebaseAuthorizedDomain;
export const removeAuthorizedDomain = removeFirebaseAuthorizedDomain;
