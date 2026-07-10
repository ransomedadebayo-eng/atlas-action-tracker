import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    test: {
      globals: true,
      clearMocks: true,
    },
    server: {
      port: 5173,
      allowedHosts: ['atlas.ransomed.app'],
      proxy: {
        '/api': {
          target: env.ATLAS_WORKER_DEV_URL || 'http://localhost:3001',
          changeOrigin: true,
          headers: {
            Authorization: `Bearer ${env.ATLAS_API_TOKEN || ''}`,
          },
        },
      },
    },
  };
});
