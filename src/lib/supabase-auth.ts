import { createClient, type AuthChangeEvent, type User as SupabaseUser } from '@supabase/supabase-js';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://gezmtnleoyrudxztegoj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || 'sb_publishable_YXrFQ2Qr8M-CEYKZLIsbqQ_weZK--PR';
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
export type User = any;
function mapUser(user: SupabaseUser): User { return { uid: user.id, email: user.email ?? null, displayName: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'), emailVerified: Boolean(user.email_confirmed_at), getIdToken: async (forceRefresh = false) => { if (forceRefresh) await supabase.auth.refreshSession(); const { data, error } = await supabase.auth.getSession(); if (error || !data.session?.access_token) throw error || new Error('No active authentication session.'); return data.session.access_token; }, reload: async () => { await supabase.auth.getUser(); } }; }
let currentUser: User | null = null;
let initialized = false;
void supabase.auth.getSession().then(({ data }) => { currentUser = data.session?.user ? mapUser(data.session.user) : null; initialized = true; }).catch(() => { initialized = true; });
export const auth: any = { get currentUser() { return currentUser; }, get initialized() { return initialized; }, async getIdToken(forceRefresh = false) { return currentUser?.getIdToken(forceRefresh) || ''; }, async signOut() { const { error } = await supabase.auth.signOut(); if (error) throw error; } };
export function onAuthStateChanged(_auth: any, callback: (user: User | null) => void) { let active = true; void supabase.auth.getSession().then(({ data }) => { if (active) callback(data.session?.user ? mapUser(data.session.user) : null); }); const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session) => { currentUser = session?.user ? mapUser(session.user) : null; if (active) callback(currentUser); }); return () => { active = false; data.subscription.unsubscribe(); }; }
export async function getRedirectResult(_auth: any) { const { data, error } = await supabase.auth.getSession(); if (error) throw error; return data.session?.user ? { user: mapUser(data.session.user) } : null; }
function authError(code: string, message: string) { return Object.assign(new Error(message), { code }); }
export async function signInWithEmailAndPassword(_auth: any, email: string, password: string) { const { data, error } = await supabase.auth.signInWithPassword({ email, password }); if (error) { const message = error.message.toLowerCase(); if (message.includes('email not confirmed')) throw authError('auth/email-not-verified', 'Email not confirmed'); if (message.includes('invalid login credentials')) throw authError('auth/invalid-credential', error.message); throw authError('auth/network-request-failed', error.message); } if (!data.user) throw authError('auth/invalid-credential', 'Authentication did not return a user.'); currentUser = mapUser(data.user); return { user: currentUser }; }
export async function createUserWithEmailAndPassword(_auth: any, email: string, password: string) { const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/login` } }); if (error) { if (error.message.toLowerCase().includes('already registered')) throw authError('auth/email-already-in-use', error.message); if (error.message.toLowerCase().includes('password')) throw authError('auth/weak-password', error.message); throw authError('auth/network-request-failed', error.message); } if (!data.user) throw authError('auth/invalid-credential', 'Account creation did not return a user.'); currentUser = data.session ? mapUser(data.user) : null; return { user: mapUser(data.user) }; }
export async function reload(user: User) { const { data, error } = await supabase.auth.getUser(); if (error) throw error; if (data.user?.id === user.uid) Object.assign(user, mapUser(data.user)); }
export async function sendEmailVerification(user: User) { if (!user.email) throw authError('auth/missing-email', 'The account has no email address.'); const { error } = await supabase.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: `${window.location.origin}/login` } }); if (error) throw authError('auth/network-request-failed', error.message); }
export async function sendPasswordResetEmail(_auth: any, email: string) { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` }); if (error) throw authError('auth/network-request-failed', error.message); }
export async function signOut(_auth: any) { await auth.signOut(); }
export async function signInWithOAuth(provider: 'google' | 'github' = 'google') { const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/login` } }); if (error) throw error; }
export async function signInWithPopup(_auth: any, _provider?: unknown) { await signInWithOAuth('google'); return { user: currentUser }; }
export async function signInWithRedirect(_auth: any, _provider?: unknown) { await signInWithOAuth('google'); }
export const googleAuthProvider = { providerId: 'google' };

// Temporary compatibility surface for the existing MFA UI. Authentication
// itself is Supabase; these methods intentionally fail closed until the MFA
// screen is moved to supabase.auth.mfa.*.
export const EmailAuthProvider = { credential: (email: string, password: string) => ({ email, password }) };
export const TotpMultiFactorGenerator = { FACTOR_ID: 'totp', generateSecret: async () => { throw new Error('Authenticator enrollment is being migrated to Supabase MFA.'); }, assertionForEnrollment: () => { throw new Error('Authenticator enrollment is being migrated to Supabase MFA.'); }, assertionForSignIn: () => { throw new Error('Authenticator sign-in is being migrated to Supabase MFA.'); } };
export function multiFactor(_user: User): any { return { enrolledFactors: [], getSession: async () => { throw new Error('Authenticator enrollment is being migrated to Supabase MFA.'); }, enroll: async () => { throw new Error('Authenticator enrollment is being migrated to Supabase MFA.'); }, unenroll: async () => { throw new Error('Authenticator removal is being migrated to Supabase MFA.'); } }; }
export async function reauthenticateWithCredential(user: User, credential: { email: string; password: string }) { return signInWithEmailAndPassword(auth, credential.email, credential.password); }
export function getMultiFactorResolver(): any { return null; }


