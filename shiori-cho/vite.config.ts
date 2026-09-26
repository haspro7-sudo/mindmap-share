import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Strict CSP, injected into the built index.html only (the dev server needs inline HMR scripts).
// docs/SPEC.md §7.3 — zero third-party requests at runtime.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'shiori-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  // Relative base + hash routing → works under any GitHub Pages subpath.
  base: process.env.VITE_BASE ?? './',
  // The initial chunk (React + zod + bundled demo manifests) is ~200 kB gzipped and fully precached for offline use;
  // the studio and PC simulator are lazy-loaded.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'しおり帳',
        short_name: 'しおり帳',
        description: '作品に一枚はさむ、しおりの手帖',
        lang: 'ja',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f7f3ea',
        theme_color: '#f7f3ea',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest,txt}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
