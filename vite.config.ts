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

  if (env('SPR_REQUIRE_FIREBASE_CONFIG') === 'true') {
    const required = { apiKey: 'VITE_FIREBASE_API_KEY', authDomain: 'VITE_FIREBASE_AUTH_DOMAIN', projectId: 'VITE_FIREBASE_PROJECT_ID', appId: 'VITE_FIREBASE_APP_ID' } as const;
    const absent = (Object.keys(required) as Array<keyof typeof required>).filter((key) => !firebaseEnv[key]);
    if (absent.length) {
      throw new Error(
        `Refusing to build a deployable bundle without Firebase browser configuration. Missing: ${absent
          .map((key) => required[key])
          .join(', ')}. Pass them as Docker build args; without them the shipped app renders but sign-in is disabled.`,
      );
    }
  }

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
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            firebase: ['firebase', 'firebase-admin'],
            charts: ['d3', 'recharts'],
            documents: ['jspdf', 'jspdf-autotable', 'html2canvas'],
            ui: ['lucide-react', 'motion'],
            data: ['drizzle-orm', 'pg', 'ioredis'],
          },
        },
      },
    },
  };
});
