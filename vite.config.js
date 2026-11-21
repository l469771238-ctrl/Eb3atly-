import { defineConfig } from 'vite';

// Relative base so the built app works inside the Capacitor WebView as well as in a browser.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
});
