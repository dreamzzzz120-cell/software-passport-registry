import { describe, expect, it } from 'vitest';
import { resolveFirebaseConfig } from '../src/lib/firebase';

describe('resolveFirebaseConfig', () => {
  it('uses safe fallback values when browser Firebase env is missing', () => {
    const config = resolveFirebaseConfig({
      VITE_FIREBASE_API_KEY: undefined,
      VITE_FIREBASE_AUTH_DOMAIN: undefined,
      VITE_FIREBASE_PROJECT_ID: undefined,
      VITE_FIREBASE_STORAGE_BUCKET: undefined,
      VITE_FIREBASE_MESSAGING_SENDER_ID: undefined,
      VITE_FIREBASE_APP_ID: undefined,
      VITE_FIREBASE_MEASUREMENT_ID: undefined,
    });

    expect(config.apiKey).toBe('demo-api-key');
    expect(config.projectId).toBe('demo-project');
    expect(config.authDomain).toBe('demo-project.firebaseapp.com');
    expect(config.appId).toBe('1:0000000000:web:demo');
  });
});
