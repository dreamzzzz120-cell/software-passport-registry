/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithPopup, signOut, type User } from 'firebase/auth';

// Firebase browser configuration is public configuration. Production must use
// the Vercel VITE_FIREBASE_* values; never silently point a real deployment at
// a fake/demo Firebase project. LoginView already blocks auth operations when
// firebaseConfigured is false, so a missing production variable is surfaced
// as a configuration error instead of an opaque Firebase API-key failure.
export function resolveFirebaseConfig(env: Record<string, string | undefined>) {
  const fallbackConfig = {
    apiKey: 'spr-missing-firebase-config',
    authDomain: 'spr-missing-firebase-config.invalid',
    projectId: 'spr-missing-firebase-config',
    storageBucket: 'spr-missing-firebase-config.invalid',
    messagingSenderId: '0000000000',
    appId: 'spr-missing-firebase-config',
    measurementId: 'G-MISSINGCONFIG',
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
  console.error('[Firebase Config] Missing required VITE_FIREBASE_* environment variables. Authentication is disabled until the Vercel Production variables are configured.');
}

const firebaseConfig = envConfig;

export const firebaseConfigured = Boolean(
  env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_AUTH_DOMAIN && env.VITE_FIREBASE_APP_ID,
);

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Local development only: point the client SDK at a local Auth emulator
// instead of the real SPR Firebase project. Never set VITE_FIREBASE_AUTH_EMULATOR_HOST
// in a deployed environment.
const emulatorHost = env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });

auth.useDeviceLanguage();

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
export { signInWithPopup, signOut };
export type { User };
