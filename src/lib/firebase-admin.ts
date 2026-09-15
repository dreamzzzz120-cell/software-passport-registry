/**
 * Supabase authentication adapter retained under the historical module name
 * so existing SPR server routes can migrate without a flag-day rename.
 *
 * Authentication is Supabase-only. No Firebase SDK or Firebase credentials are
 * loaded by this module.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let client: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

function requireUrl() {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required for authentication');
  return SUPABASE_URL;
}

function getClient(): SupabaseClient {
  if (!SUPABASE_KEY) throw new Error('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY is required for token verification');
  if (!client) client = createClient(requireUrl(), SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function getAdminClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for administrative authentication operations');
  if (!adminClient) adminClient = createClient(requireUrl(), SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

export const adminAuth = {
  async verifyIdToken(token: string, _checkRevoked = false) {
    const { data, error } = await getClient().auth.getUser(token);
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
    const { data, error } = await getAdminClient().auth.admin.listUsers({ page: 1, perPage });
    if (error) throw error;
    return data.users;
  },

  async getUserByEmail(email: string) {
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await getAdminClient().auth.admin.listUsers({ page, perPage });
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
    const { data, error } = await getAdminClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: input.emailVerified,
      user_metadata: input.displayName ? { full_name: input.displayName, displayName: input.displayName } : undefined,
    });
    if (error || !data.user) throw error || new Error('Unable to create Supabase user');
    if (input.disabled !== undefined) {
      const { error: updateError } = await getAdminClient().auth.admin.updateUserById(data.user.id, { ban_duration: input.disabled ? '876000h' : 'none' });
      if (updateError) throw updateError;
    }
    return { uid: data.user.id, email: data.user.email, emailVerified: Boolean(data.user.email_confirmed_at) };
  },

  async generatePasswordResetLink(email: string) {
    const { data, error } = await getAdminClient().auth.admin.generateLink({ type: 'recovery', email });
    if (error || !data.properties?.action_link) throw error || new Error('Unable to generate password reset link');
    return data.properties.action_link;
  },

  async generateEmailVerificationLink(email: string) {
    const { data, error } = await getAdminClient().auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.action_link) throw error || new Error('Unable to generate email verification link');
    return data.properties.action_link;
  },

  async updateUser(uid: string, input: { disabled?: boolean }) {
    const { data, error } = await getAdminClient().auth.admin.updateUserById(uid, { ban_duration: input.disabled ? '876000h' : 'none' });
    if (error || !data.user) throw error || new Error('Unable to update Supabase user');
    return { uid: data.user.id, email: data.user.email };
  },

  async revokeRefreshTokens(_uid: string) { return undefined; },

  async deleteUser(uid: string) {
    const { error } = await getAdminClient().auth.admin.deleteUser(uid);
    if (error) throw error;
    return undefined;
  },

  // Kept only for callers that have not yet been renamed. Authorization must
  // continue to come from the database/RLS, never from client-controlled JWT metadata.
  async setCustomUserClaims(_uid: string, _claims: Record<string, unknown>) { return undefined; },
};

export async function setUserCustomClaims(_uid: string, _claims: Record<string, unknown>) { return undefined; }
export async function ensureFirebaseAuthorizedDomain(_domain: string) { return undefined; }
export async function removeFirebaseAuthorizedDomain(_domain: string) { return undefined; }
export const addAuthorizedDomain = ensureFirebaseAuthorizedDomain;
export const removeAuthorizedDomain = removeFirebaseAuthorizedDomain;
