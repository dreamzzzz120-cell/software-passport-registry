/**
 * Legacy module path kept temporarily so the existing application shell does
 * not need a risky broad import rewrite. There is no Firebase runtime here.
 * All browser authentication is Supabase Auth.
 */
export {
  auth,
  supabase,
  supabaseConfigured,
  onAuthStateChanged,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  signInWithPopup,
  signInWithRedirect,
  googleAuthProvider,
  type User,
} from './supabase-auth';

export const firebaseConfigured = supabaseConfigured;
