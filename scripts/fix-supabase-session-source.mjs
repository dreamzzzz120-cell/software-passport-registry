import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/App.tsx';
let source = await readFile(path, 'utf8');

// Vercel builds start from a clean checkout, while local builds may run more
// than once against the same working tree. Do not rewrite an already-patched
// source file on subsequent builds.
if (source.includes("import { supabase } from './lib/supabase';") && source.includes('type AppAuthUser =')) {
  process.exit(0);
}

source = source.replace(
  "import { getRedirectResult, onAuthStateChanged, signOut, type User } from 'firebase/auth';",
  "import { supabase } from './lib/supabase';"
);
source = source.replace("import { auth } from './lib/firebase';\n", '');
source = source.replace(
  "const [user, setUser] = useState<User | null>(null);",
  "type AppAuthUser = { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 };\n  const [user, setUser] = useState<AppAuthUser | null>(null);"
);

const authEffectStart = "  useEffect(() => {\n    let mounted = true;\n    let redirectSettled = false;";
const authEffectEnd = "  useEffect(() => { if (authReady && !user && !isPublicPath(path)) navigate('/login'); }, [authReady, user, path]);";
const start = source.indexOf(authEffectStart);
const end = source.indexOf(authEffectEnd);
if (start < 0 || end < 0 || end <= start) throw new Error('Could not locate App auth effect');

const replacement = `  useEffect(() => {
    let mounted = true;
    let settling = true;
    const timeoutId = window.setTimeout(() => {
      if (mounted) setAuthReady(true);
    }, 10_000);

    const applySession = (session) => {
      if (!mounted || !session?.user || !session.access_token) return;
      const authUser = session.user;
      setUser({
        uid: authUser.id,
        email: authUser.email ?? null,
        displayName: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
        token: session.access_token,
        emailVerified: Boolean(authUser.email_confirmed_at),
        onboarded: 0,
      });
      setAuthReady(true);
      window.clearTimeout(timeoutId);
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      settling = false;
      if (data.session) applySession(data.session);
      else setAuthReady(true);
      window.clearTimeout(timeoutId);
    }).catch((error) => {
      console.error('[Supabase session restore error]', error);
      if (mounted) {
        settling = false;
        setAuthReady(true);
        window.clearTimeout(timeoutId);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) {
        applySession(session);
        return;
      }
      // A null event during initial hydration must not race a valid session
      // back to /login. Explicit sign-out remains the only normal path that
      // clears the app user.
      if (!settling) {
        setUser(null);
        setAuthReady(true);
      }
    });

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      listener.subscription.unsubscribe();
    };
  }, []);
`;
source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace(/auth\.currentUser\?\.emailVerified/g, 'user?.emailVerified');
source = source.replace(/auth\.currentUser\.getIdToken\(true\);/g, 'await supabase.auth.getSession();');
source = source.replace(/await signOut\(auth\);/g, 'await supabase.auth.signOut();');

await writeFile(path, source);
