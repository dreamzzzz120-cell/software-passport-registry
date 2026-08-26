import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const env = (name: string) => process.env[name] ?? fileEnv[name];
  const firebaseEnv = {
    apiKey: env('VITE_FIREBASE_API_KEY') ?? env('apiKey'),
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN') ?? env('authDomain'),
    projectId: env('VITE_FIREBASE_PROJECT_ID') ?? env('projectId'),
    storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET') ?? env('storageBucket'),
    messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID') ?? env('messagingSenderId'),
    appId: env('VITE_FIREBASE_APP_ID') ?? env('appId'),
    measurementId: env('VITE_FIREBASE_MEASUREMENT_ID') ?? env('measurementId'),
  };

  return {
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(firebaseEnv.apiKey ?? ''),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(firebaseEnv.authDomain ?? ''),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(firebaseEnv.projectId ?? ''),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(firebaseEnv.storageBucket ?? ''),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(firebaseEnv.messagingSenderId ?? ''),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(firebaseEnv.appId ?? ''),
      'import.meta.env.VITE_FIREBASE_MEASUREMENT_ID': JSON.stringify(firebaseEnv.measurementId ?? ''),
    },
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target: env('VITE_DEV_API_PROXY_TARGET') ?? 'http://localhost:3000', changeOrigin: true },
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
  };
});
