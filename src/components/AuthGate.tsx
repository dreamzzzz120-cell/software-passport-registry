import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, reload, sendEmailVerification, signOut, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';

const PUBLIC_PATHS = new Set(['/', '/login', '/pricing', '/free-review']);

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const path = window.location.pathname || '/';
  const publicPath = isPublicPath(path);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(publicPath);

  useEffect(() => {
    if (publicPath) return;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setReady(true);
    }, () => {
      setUser(null);
      setReady(true);
    });
  }, [publicPath]);

  useEffect(() => {
    if (publicPath || !ready || user) return;
    if (window.location.pathname !== '/login') {
      window.history.replaceState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [publicPath, ready, user]);

  useEffect(() => {
    if (!user || user.emailVerified) return;
    let cancelled = false;
    void (async () => {
      try { await reload(user); } catch { /* Auth state remains authoritative. */ }
      if (!cancelled && !user.emailVerified) {
        try { await sendEmailVerification(user); } catch { /* Rate limits are safe to ignore here. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (publicPath) return <>{children}</>;
  if (!ready) return <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4] grid place-items-center"><div role="status" aria-live="polite" className="text-sm text-[#9d9d9d]">Checking secure session…</div></div>;
  if (!user) return <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4] grid place-items-center"><div role="status" aria-live="polite" className="text-sm text-[#9d9d9d]">Redirecting to sign in…</div></div>;
  if (!user.emailVerified) return <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4] grid place-items-center p-6"><div className="max-w-md spr-panel p-6"><h1 className="text-xl font-semibold">Verify your email</h1><p className="mt-2 text-sm text-[#9d9d9d]">Your account must be email-verified before you can access the SPR workspace.</p><button className="spr-btn spr-btn-primary mt-5" onClick={() => void signOut(auth)}>Sign out</button></div></div>;

  return <>{children}</>;
}
