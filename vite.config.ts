import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png', 'icons.svg'],
      manifest: {
        name: 'ISA & FIRE Tracker',
        short_name: 'ISA & FIRE',
        description: 'Track ISA/SIPP portfolios and FIRE progress',
        theme_color: '#02061a',
        background_color: '#02061a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Hashed chunks must 404 loudly in stale clients instead of being
        // masked by index.html, or lazy loading breaks in confusing ways.
        navigateFallbackDenylist: [/^\/assets\//],
        runtimeCaching: [
          // Never cache data/auth APIs — stale finance data is worse than none,
          // and the app has its own localStorage fallback for offline reads.
          { urlPattern: /supabase\.co/, handler: 'NetworkOnly' },
          { urlPattern: /firestore\.googleapis\.com/, handler: 'NetworkOnly' },
          { urlPattern: /frankfurter\.dev/, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
})
