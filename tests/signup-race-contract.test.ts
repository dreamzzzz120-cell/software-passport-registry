import { describe, expect, it } from 'vitest';
import { readCode as read } from './helpers/source-contract.ts';

describe('Supabase authentication contract', () => {
  it('uses Supabase Auth for password sign-in and signup', () => {
    const login = read('src/components/LoginView.tsx');
    expect(login).toContain("supabase.auth.signInWithPassword");
    expect(login).toContain("supabase.auth.signUp");
    expect(login).not.toContain("firebase/auth");
    expect(login).not.toContain('signInWithEmailAndPassword(auth');
  });

  it('requires a confirmed Supabase email before workspace access', () => {
    const login = read('src/components/LoginView.tsx');
    expect(login).toContain('email_confirmed_at');
    expect(login).toContain('Check your email and confirm your account before signing in.');
  });

  it('uses the Supabase access token for server authorization', () => {
    const login = read('src/components/LoginView.tsx');
    expect(login).toContain('session.access_token');
    expect(login).toContain('Authorization');
  });

  it('keeps provisioning server-side rather than creating a second client path', () => {
    const login = read('src/components/LoginView.tsx');
    expect(login).toContain('/api/auth/workspace');
  });

  it('server authentication no longer depends on Firebase token verification', () => {
    const security = read('src/middleware/security.ts');
    const firebaseAdmin = read('src/lib/firebase-admin.ts');
    expect(security).toContain('adminAuth.verifyIdToken');
    expect(firebaseAdmin).toContain('@supabase/supabase-js');
    expect(firebaseAdmin).not.toContain("from 'firebase-admin'");
  });
});
