import { describe, expect, it } from 'vitest';
import { resolveFirebaseConfig } from '../src/lib/firebase';

describe('resolveFirebaseConfig', () => {
  it('uses the safe missing-config marker when browser Firebase env is missing', () => {
    const config = resolveFirebaseConfig({
      VITE_FIREBASE_API_KEY: undefined,
      VITE_FIREBASE_AUTH_DOMAIN: undefined,
      VITE_FIREBASE_PROJECT_ID: undefined,
      VITE_FIREBASE_STORAGE_BUCKET: undefined,
      VITE_FIREBASE_MESSAGING_SENDER_ID: undefined,
      VITE_FIREBASE_APP_ID: undefined,
      VITE_FIREBASE_MEASUREMENT_ID: undefined,
    });

    expect(config.apiKey).toBe('spr-missing-firebase-config');
    expect(config.projectId).toBe('spr-missing-firebase-config');
    expect(config.authDomain).toBe('spr-missing-firebase-config.invalid');
    expect(config.appId).toBe('spr-missing-firebase-config');
  });
});
