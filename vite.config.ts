import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const env = (name: string) => process.env[name] ?? fileEnv[name];
  const supabaseUrl = env('VITE_SUPABASE_URL');
  const supabaseKey = env('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (env('SPR_REQUIRE_SUPABASE_CONFIG') === 'true' && (!supabaseUrl || !supabaseKey)) {
    throw new Error('Refusing to build a deployable bundle without Supabase browser configuration. Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  return {
    resolve: {
      alias: {
        'firebase/auth': fileURLToPath(new URL('./src/lib/supabase-auth.ts', import.meta.url)),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl ?? ''),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey ?? ''),
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
            charts: ['d3', 'recharts'],
            documents: ['jspdf', 'jspdf-autotable', 'html2canvas'],
            ui: ['lucide-react', 'motion'],
          },
        },
      },
    },
  };
});
