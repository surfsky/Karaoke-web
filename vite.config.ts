import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

function onnxWasmMiddlewarePlugin() {
  return {
    name: 'onnx-wasm-middleware',
    configureServer(server: import('vite').ViteDevServer) {
      // 在 Vite 内部 transform middleware 之前注册，直接返回 public 中的 wasm js worker
      return () => {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.includes('.mjs?import')) {
            console.log('[onnx-wasm-middleware] intercept', req.url)
            const url = new URL(req.url, `http://${req.headers.host}`)
            const filePath = path.resolve('public', url.pathname.slice(1))
            if (fs.existsSync(filePath)) {
              console.log('[onnx-wasm-middleware] serve', filePath)
              res.setHeader('Content-Type', 'application/javascript')
              fs.createReadStream(filePath).pipe(res)
              return
            }
            console.log('[onnx-wasm-middleware] file not found', filePath)
          }
          next()
        })
      }
    },
  }
}

export default defineConfig({
  base: '/Karaoke-web/',
  plugins: [
    onnxWasmMiddlewarePlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons.svg', 'icons/*.svg'],
      devOptions: {
        enabled: true,
        type: 'module',
      },
      workbox: {
        // 仅 precache 应用壳资源；wasm/onnx/音频走 runtime cache
        globPatterns: [
          'index.html',
          'assets/*.{js,css}',
          'icons/**/*.{svg,png}',
          'favicon.svg',
          'icons.svg',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /\.onnx$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'model-cache',
              expiration: {
                maxEntries: 3,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /\.(?:mp3|wav|ogg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: {
                maxEntries: 32,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
      manifest: {
        id: '/Karaoke-web/',
        name: 'Karaoke Web',
        short_name: 'Karaoke',
        description: '浏览器 K 歌应用，支持 AI 人声分离',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/Karaoke-web/',
        scope: '/Karaoke-web/',
        lang: 'zh-CN',
        orientation: 'any',
        categories: ['music', 'entertainment'],
        icons: [
          {
            src: '/Karaoke-web/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/Karaoke-web/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/Karaoke-web/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
})
