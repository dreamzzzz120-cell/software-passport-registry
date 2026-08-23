import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Vercel currently stores the Firebase web config under unprefixed names
  // (apiKey/authDomain/etc.). Vite only exposes VITE_* variables to browser
  // code, so bridge the build-time values explicitly while preserving the
  // existing VITE_FIREBASE_* names used by src/lib/firebase.ts.
  const env = loadEnv(mode, process.cwd(), '');
  const firebaseEnv = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? env.apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? env.authDomain,
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? env.projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? env.storageBucket,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? env.messagingSenderId,
    appId: env.VITE_FIREBASE_APP_ID ?? env.appId,
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? env.measurementId,
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
    build: {
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              if (id.includes('/src/components/')) {
                const match = id.match(/\/src\/components\/([^\/]+)\.tsx?$/);
                if (match) return `view-${match[1].replace(/View$/, '').toLowerCase()}`;
              }
              return undefined;
            }
            if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-runtime';
            if (id.includes('/jspdf/') || id.includes('/jspdf-autotable/')) return 'pdf-core';
            if (id.includes('/html2canvas/')) return 'html2canvas';
            if (id.includes('/firebase/')) return 'firebase';
            if (id.includes('/recharts/') || id.includes('/d3/')) return 'charts';
            if (id.includes('/lucide-react/')) return 'icons';
            if (id.includes('/dompurify/')) return 'sanitization';
            if (id.includes('/@supabase/')) return 'supabase';
            if (id.includes('/zod/')) return 'validation';
            return 'vendor';
          },
        },
      },
    },
  };
});
