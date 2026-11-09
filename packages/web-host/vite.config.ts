import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'KMind Palace',
        short_name: 'KMind',
        description: 'Memory Palace for knowledge management',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#1a1a2e',
        background_color: '#e9dfd2',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5182,
    strictPort: false,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:5184',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/v1/, '/api/v1'),
      },
    },
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: { main: 'src/main.ts' },
    },
  },
});
