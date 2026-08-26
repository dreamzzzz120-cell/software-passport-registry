/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithPopup, signOut, type User } from 'firebase/auth';

// Firebase browser configuration is public configuration. Prefer Vite environment
// variables, but fall back to a harmless demo config (rather than a real production
// project) so a missing Vercel build variable cannot blank the entire React application
// or silently point local/dev builds at the production Firebase project.
export function resolveFirebaseConfig(env: Record<string, string | undefined>) {
  const fallbackConfig = {
    apiKey: 'demo-api-key',
    authDomain: 'demo-project.firebaseapp.com',
    projectId: 'demo-project',
    storageBucket: 'demo-project.appspot.com',
    messagingSenderId: '0000000000',
    appId: '1:0000000000:web:demo',
    measurementId: 'G-DEMO123',
  };

  return {
    apiKey: env.VITE_FIREBASE_API_KEY || fallbackConfig.apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || fallbackConfig.authDomain,
    projectId: env.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || fallbackConfig.storageBucket,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId,
    appId: env.VITE_FIREBASE_APP_ID || fallbackConfig.appId,
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || fallbackConfig.measurementId,
  };
}

const env = import.meta.env;
const envConfig = resolveFirebaseConfig(env);

if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID || !env.VITE_FIREBASE_AUTH_DOMAIN || !env.VITE_FIREBASE_APP_ID) {
  console.warn('[Firebase Config] Missing required VITE_FIREBASE_* environment variables; using safe demo config in the browser.');
}

const firebaseConfig = envConfig;

export const firebaseConfigured = Boolean(
  env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_AUTH_DOMAIN && env.VITE_FIREBASE_APP_ID,
);

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Local development only: point the client SDK at a local Auth emulator
// instead of the real spr4-c2c65 project. Never set VITE_FIREBASE_AUTH_EMULATOR_HOST
// in a deployed environment.
const emulatorHost = env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });

auth.useDeviceLanguage();

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
export { signInWithPopup, signOut };
export type { User };
