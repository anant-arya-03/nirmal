import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: 'dist',
    rolldownOptions: {
      onwarn(warning, warn) {
        // This is a client-only SPA; React Server Component boundaries do not apply.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        warn(warning);
      }
    }
  }
});
