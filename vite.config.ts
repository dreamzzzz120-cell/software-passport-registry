import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Keep App.tsx imports synchronous. Feature components are already emitted
  // as dedicated Rollup chunks; this config keeps the initial vendor graph small.
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
          // Keep React's runtime graph isolated from the general vendor graph.
          // This improves cache reuse and prevents the shared vendor chunk from
          // becoming the initial-page bottleneck as extensions are added.
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-runtime';
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
