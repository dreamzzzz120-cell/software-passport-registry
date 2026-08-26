/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithPopup, signOut, type User } from 'firebase/auth';

// Firebase browser configuration is public configuration. Prefer Vite environment
// variables, but keep the production project's public config as a fallback so a
// missing Vercel build variable cannot blank the entire React application.
const env = import.meta.env;
const envConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

const fallbackConfig = {
  apiKey: 'AIzaSyC1C1o3ekPT6QtZJwP1RmLwuA2-TIxRAtc',
  authDomain: 'spr4-c2c65.firebaseapp.com',
  projectId: 'spr4-c2c65',
  storageBucket: 'spr4-c2c65.firebasestorage.app',
  messagingSenderId: '535878442566',
  appId: '1:535878442566:web:21c920f618a402aad63447',
  measurementId: 'G-MG0KW2RCQ5',
};

const firebaseConfig = {
  apiKey: envConfig.apiKey || fallbackConfig.apiKey,
  authDomain: envConfig.authDomain || fallbackConfig.authDomain,
  projectId: envConfig.projectId || fallbackConfig.projectId,
  storageBucket: envConfig.storageBucket || fallbackConfig.storageBucket,
  messagingSenderId: envConfig.messagingSenderId || fallbackConfig.messagingSenderId,
  appId: envConfig.appId || fallbackConfig.appId,
  measurementId: envConfig.measurementId || fallbackConfig.measurementId,
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain && firebaseConfig.appId,
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
