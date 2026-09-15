import { describe, expect, it } from 'vitest';
import { readCode as read } from './helpers/source-contract.ts';

describe('Supabase authentication contract', () => {
  it('uses Supabase Auth for password sign-in and signup', () => { const login = read('src/components/LoginView.tsx'); expect(login).toContain('supabase.auth.signInWithPassword'); expect(login).toContain('supabase.auth.signUp'); expect(login).not.toContain('firebase/auth'); });
  it('requires a confirmed Supabase email before workspace access', () => { const login = read('src/components/LoginView.tsx'); expect(login).toContain('email_confirmed_at'); expect(login).toContain('Check your email and confirm your account before signing in.'); });
  it('uses the Supabase access token for server authorization', () => { const client = read('src/utils/apiClient.ts'); expect(client).toContain('Authorization'); expect(client).toContain('getIdToken'); });
  it('keeps provisioning centralized in the authenticated application shell', () => { const app = read('src/App.tsx'); expect(app).toContain('/api/user/me'); expect(app).toContain('applyUser'); const login = read('src/components/LoginView.tsx'); expect(login).not.toContain('/api/auth/workspace'); });
  it('server authentication no longer depends on Firebase token verification', () => { const security = read('src/middleware/security.ts'); const firebaseAdmin = read('src/lib/firebase-admin.ts'); expect(security).toContain('adminAuth.verifyIdToken'); expect(firebaseAdmin).toContain('@supabase/supabase-js'); expect(firebaseAdmin).not.toContain("from 'firebase-admin'"); });
});
