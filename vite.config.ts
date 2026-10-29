import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The local server (server.mjs, port 4747) serves the built app and the lesson feed; in `npm run dev`
// Vite forwards those calls to it.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Learning Board',
        short_name: 'Learning Board',
        description: 'Draw, connect and play through ideas: perfect shapes, connected arrows, flowing dots, steps and quiz covers.',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell works offline. Fonts are cached when first used (the large Chinese font only
        // if a board needs it), not all up front.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Excalidraw's optional extras (text-to-diagram, maths) are fetched only if used.
        globIgnores: ['**/*Diagram*', '**/cytoscape*', '**/katex*', '**/mermaid*', '**/swimlanes*', '**/cose-bilkent*', '**/dagre*', '**/fonts/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/events/, /^\/player\//],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4747', '/events': 'http://127.0.0.1:4747', '/player': 'http://127.0.0.1:4747' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
