import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' zodat de app werkt onder https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        redirect: resolve(import.meta.dirname, 'redirect.html'),
      },
    },
  },
});
