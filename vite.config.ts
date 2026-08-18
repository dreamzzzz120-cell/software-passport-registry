import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function lazyAppViews(): Plugin {
  const componentImport = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+['\"](\./components/[^'\"]+)['\"];?$/gm;

  return {
    name: 'spr-lazy-app-views',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/App.tsx')) return null;
      const transformed = code.replace(
        componentImport,
        (_match, name: string, modulePath: string) =>
          `const ${name} = React.lazy(() => import('${modulePath}'));`,
      );
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [lazyAppViews(), react(), tailwindcss()],
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
          if (id.includes('/motion/')) return 'motion';
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