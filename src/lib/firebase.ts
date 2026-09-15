import { supabaseConfigured as configured } from './supabase-auth';
export { auth, supabase, supabaseConfigured, onAuthStateChanged, getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, reload, sendEmailVerification, sendPasswordResetEmail, signOut, signInWithPopup, signInWithRedirect, googleAuthProvider, type User } from './supabase-auth';

export const firebaseConfigured = configured;
export function resolveFirebaseConfig(_env: Record<string, string | undefined>) {
  return { apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '', measurementId: '' };
}
