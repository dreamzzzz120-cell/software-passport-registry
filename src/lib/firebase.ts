/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, GoogleAuthProvider, getAuth, initializeAuth, signInWithPopup, signOut, type User } from 'firebase/auth';

const envConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const hasFirebaseConfig = Boolean(
  envConfig.apiKey &&
  envConfig.projectId &&
  envConfig.authDomain &&
  envConfig.appId,
);

// Do not crash the entire React application when browser configuration is
// missing. The UI can render and surface an actionable authentication error.
export const firebaseConfigured = hasFirebaseConfig;

const app = hasFirebaseConfig ? initializeApp(envConfig) : null;

export const auth = (() => {
  if (!app) return null;
  try {
    return initializeAuth(app, { persistence: browserLocalPersistence });
  } catch {
    return getAuth(app);
  }
})();

if (auth) auth.useDeviceLanguage();

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
export { signInWithPopup, signOut };
export type { User };
