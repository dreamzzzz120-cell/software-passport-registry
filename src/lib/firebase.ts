/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const envConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId,
  oAuthClientId: import.meta.env.VITE_FIREBASE_OAUTH_CLIENT_ID || firebaseConfig.oAuthClientId,
};

if (!envConfig.apiKey || !envConfig.projectId || !envConfig.authDomain || !envConfig.appId) {
  throw new Error('[Firebase Config] Missing required Firebase client configuration. Set VITE_FIREBASE_* env vars or provide firebase-applet-config.json.');
}

// Initialize Firebase
const app = initializeApp(envConfig);

// Initialize Firebase Auth
export const auth = getAuth(app);

// Use a persistent session for browser logins
auth.useDeviceLanguage();
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] Failed to persist session locally:', err);
});

// Provider for Google OAuth
export const googleAuthProvider = new GoogleAuthProvider();

googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export { signInWithPopup, signOut };
export type { User };
