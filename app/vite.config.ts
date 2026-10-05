/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Карточки слов',
        short_name: 'Карточки',
        lang: 'ru',
        display: 'standalone',
        start_url: '.',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        globIgnores: ['content/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/content/') && url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'content-json', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
});
