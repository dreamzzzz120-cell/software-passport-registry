import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'lucide-react': resolve(__dirname, 'src/lucide-compat.ts'),
    },
  },
  // Keep App.tsx imports as normal synchronous React imports.
  // The previous source-transform converted them to React.lazy() without
  // importing React or providing Suspense, which can blank the entire SPA at
  // runtime even though the Vite build succeeds.
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
          if (id.includes('/jspdf/') || id.includes('/jspdf-autotable/')) return 'pdf-core';
          if (id.includes('/html2canvas/')) return 'html2canvas';
          if (id.includes('/firebase/')) return 'firebase';
          if (id.includes('/recharts/') || id.includes('/d3/')) return 'charts';
          // Keep motion with the general vendor graph. Splitting it into its own
          // manual chunk creates a motion -> vendor -> motion cycle in Rollup.
          if (id.includes('/lucide-react/')) return 'icons';
          if (id.includes('/dompurify/')) return 'sanitization';
          if (id.includes('/@supabase/')) return 'supabase';
          if (id.includes('/zod/')) return 'validation';
          return 'vendor';
        },
      },
    },
  },
});
