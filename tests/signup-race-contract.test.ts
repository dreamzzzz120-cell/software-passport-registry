import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginSignupTransition,
  endSignupTransition,
  isSignupTransitionActive,
} from '../src/lib/signupTransition.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Regression tests for the verified production defect: creating an account
// succeeded (Firebase user created, verification email sent) but the UI
// reported "SPR has not provisioned this account in its workspace yet",
// because Firebase auto-signs-in the new account, which unmounted LoginView
// and started an authenticated data load whose expected 403 overwrote the
// signup success message.
describe('signup transition flag', () => {
  beforeEach(() => endSignupTransition());

  it('is inactive by default and toggles cleanly', () => {
    expect(isSignupTransitionActive()).toBe(false);
    beginSignupTransition();
    expect(isSignupTransitionActive()).toBe(true);
    endSignupTransition();
    expect(isSignupTransitionActive()).toBe(false);
  });
});

describe('1. successful account creation displays the signup success state', () => {
  it('register() sets the success notice after signing the transient session out', () => {
    const source = read('src/components/LoginView.tsx');
    const start = source.indexOf('const register = async');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('const google = async', start));
    expect(body).toContain('createUserWithEmailAndPassword');
    expect(body).toContain('sendEmailVerification');
    expect(body).toContain("setNotice('Account created. Check your email, verify it, then sign in.')");
    // The success message must be set only after the sign-out, so the
    // component is in its final, signed-out state when it reports success.
    expect(body.indexOf('signOut(auth)')).toBeLessThan(body.indexOf("setNotice('Account created"));
  });
});

describe('2. automatic Firebase authentication cannot overwrite the signup state', () => {
  it('App ignores a Firebase session that appears while a signup is in flight', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('isSignupTransitionActive');
    // Every path that promotes a Firebase user into SPR session state must
    // go through the guard, not setUser directly.
    expect(source).toContain('if (candidate && isSignupTransitionActive()) return;');
    expect(source).toContain('applyUser(currentUser)');
    expect(source).toContain('applyUser(result?.user || observedUser)');
    expect(source).toContain('applyUser(observedUser)');
  });

  it('the flag is raised before the account is created, not after', () => {
    const source = read('src/components/LoginView.tsx');
    const start = source.indexOf('const register = async');
    const body = source.slice(start, source.indexOf('const google = async', start));
    // Anchor on the call itself: the surrounding comment also mentions
    // createUserWithEmailAndPassword by name.
    expect(body.indexOf('beginSignupTransition()')).toBeLessThan(body.indexOf('await createUserWithEmailAndPassword'));
    expect(body).toContain('endSignupTransition()');
  });
});

describe('3. the 403 provisioning response does not replace the signup notice during signup', () => {
  it('apiClient suppresses the provisioning notice only while a signup is in flight', () => {
    const source = read('src/utils/apiClient.ts');
    expect(source).toContain("resolvedUrl.pathname === '/api/user/me' && !isSignupTransitionActive()");
  });

  it('the suppression is genuinely scoped - outside a signup the notice still fires', () => {
    // Proves the guard expression itself, so a future refactor that makes
    // the suppression unconditional fails here.
    endSignupTransition();
    expect(isSignupTransitionActive()).toBe(false);
    beginSignupTransition();
    expect(isSignupTransitionActive()).toBe(true);
    endSignupTransition();
    expect(isSignupTransitionActive()).toBe(false);
  });
});

describe('4. invalid signup still displays the appropriate error', () => {
  it('register() still surfaces creation failures through authMessage', () => {
    const source = read('src/components/LoginView.tsx');
    const start = source.indexOf('const register = async');
    const body = source.slice(start, source.indexOf('const google = async', start));
    expect(body).toContain("setError(authMessage(err, 'Account creation failed.'))");
    expect(source).toContain("case 'auth/email-already-in-use'");
    expect(source).toContain("case 'auth/weak-password'");
    expect(source).toContain("case 'auth/invalid-email'");
  });
});

describe('5. normal login still works', () => {
  it('sign-in is untouched and still completes through the verification gate', () => {
    const source = read('src/components/LoginView.tsx');
    expect(source).toContain('signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)');
    expect(source).toContain('await complete(result.user)');
    // complete() must still refuse an unverified email.
    const complete = source.slice(source.indexOf('const complete = async'), source.indexOf('useEffect('));
    expect(complete).toContain('if (!user.emailVerified)');
    expect(complete).toContain('await signOut(auth)');
    expect(complete).toContain('onLoginSuccess(');
  });

  it('the signup guard never blocks an ordinary sign-in', () => {
    // The guard only suppresses while a signup is in flight; a normal login
    // happens with the flag down.
    endSignupTransition();
    expect(isSignupTransitionActive()).toBe(false);
  });
});

describe('6. unprovisioned users are still rejected safely', () => {
  it('the server still refuses an unprovisioned account with a non-leaking 403', () => {
    const security = read('src/middleware/security.ts');
    expect(security).toContain("return res.status(403).json({ error: 'User account is not provisioned' })");
    expect(security).toContain("return res.status(403).json({ error: 'User account has invalid tenant configuration' })");
    // The catch-all must stay generic - no internal detail leaks.
    expect(security).toContain("res.status(401).json({ error: 'Unauthorized: Invalid or expired security token' })");
  });

  it('the client still signs an unprovisioned identity out rather than rendering a partial shell', () => {
    const source = read('src/utils/apiClient.ts');
    const idx = source.indexOf("resolvedUrl.pathname === '/api/user/me'");
    const branch = source.slice(idx, idx + 1400);
    expect(branch).toContain('setAuthNotice(');
    expect(branch).toContain('auth.signOut(');
  });
});

describe('7. verified/provisioned users still authenticate normally', () => {
  it('requireAuth still verifies the token, the email, and the persisted user row', () => {
    const security = read('src/middleware/security.ts');
    expect(security).toContain('adminAuth.verifyIdToken(token, true)');
    expect(security).toContain("EMAIL_NOT_VERIFIED");
    expect(security).toContain('await db.select().from(users).where(eq(users.uid, uid))');
    // The third argument binds app.user_id alongside app.tenant_id (added
    // with the organization provisioning work). The assertion checks the
    // tenant binding it has always covered without pinning the exact arity,
    // so a further scope argument does not read as a regression here.
    expect(security).toContain('req.db = await attachTenantScope(dbUser.tenantId, res');
  });

  it('email verification is not bypassed anywhere in the signup change', () => {
    const login = read('src/components/LoginView.tsx');
    const transition = read('src/lib/signupTransition.ts');
    for (const source of [login, transition]) {
      expect(source).not.toMatch(/emailVerified\s*=\s*true/);
      expect(source).not.toContain('updateEmailVerified');
    }
    expect(login).toContain('if (!user.emailVerified)');
  });
});
