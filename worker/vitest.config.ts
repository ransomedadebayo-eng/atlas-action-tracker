import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./src/test/cloudflareWorkersMock.ts', import.meta.url).pathname,
    },
  },
});
