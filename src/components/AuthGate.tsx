import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
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

  // Never let Firebase initialization/network/auth configuration block public pages.
  useEffect(() => {
    if (publicPath) return;
    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setReady(true);
      },
      () => {
        setUser(null);
        setReady(true);
      },
    );
  }, [publicPath]);

  if (publicPath) return <>{children}</>;

  if (!ready) {
    return <div className="min-h-screen bg-slate-950 text-white grid place-items-center"><div role="status" aria-live="polite" className="text-sm text-slate-300">Checking secure session…</div></div>;
  }

  if (!user) {
    window.history.replaceState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return <>{children}</>;
  }

  if (!user.emailVerified) {
    return <div className="min-h-screen bg-slate-950 text-white grid place-items-center p-6"><div className="max-w-md rounded-xl border border-amber-300/20 bg-slate-900 p-6"><h1 className="text-xl font-semibold">Verify your email</h1><p className="mt-2 text-sm text-slate-300">Your account must be email-verified before you can access the SPR workspace.</p><button className="mt-5 rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950" onClick={() => auth.signOut()}>Sign out</button></div></div>;
  }

  return <>{children}</>;
}
