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

if (!envConfig.apiKey || !envConfig.projectId || !envConfig.authDomain || !envConfig.appId) {
  throw new Error('[Firebase Config] Missing required VITE_FIREBASE_* environment variables.');
}

const app = initializeApp(envConfig);

// Configure persistence at auth construction time so a reload cannot race
// against an asynchronous setPersistence call.
export const auth = (() => {
  try {
    return initializeAuth(app, { persistence: browserLocalPersistence });
  } catch {
    // Vite HMR can evaluate this module more than once; reuse the existing
    // Firebase Auth instance in that case.
    return getAuth(app);
  }
})();

auth.useDeviceLanguage();

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
export { signInWithPopup, signOut };
export type { User };
