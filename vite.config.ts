import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiPort = env.PORT || '3001';
    return {
      build: {
        rollupOptions: {
          input: {
            // Multi-page: the owner dashboard (index.html) and the public
            // customer-facing touchpoint chat (t.html).
            main: path.resolve(__dirname, 'index.html'),
            touchpoint: path.resolve(__dirname, 't.html'),
          },
        },
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // Forward API calls to the Express server during development.
          '/v1': {
            target: `http://localhost:${apiPort}`,
            changeOrigin: true,
          },
          // Forward the public customer-facing touchpoint page to the Express
          // server (which renders dist/t.html with the resolved payload).
          '/t': {
            target: `http://localhost:${apiPort}`,
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      define: {
        // Only the Paystack PUBLIC key is exposed to the client.
        // GROQ_API_KEY and PAYSTACK_SECRET_KEY stay server-side only.
        'process.env.PAYSTACK_PUBLIC_KEY': JSON.stringify(env.VITE_PAYSTACK_PUBLIC_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
