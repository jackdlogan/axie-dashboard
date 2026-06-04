import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The Sky Mavis GraphQL API requires an X-API-Key header. We never want that
// key to land in the client bundle, so all browser requests go to /api/graphql
// and the Vite dev server proxies them to the real endpoint, injecting the key
// server-side from the SKYMAVIS_API_KEY env var (loaded from .env).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.SKYMAVIS_API_KEY

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/graphql': {
          target: 'https://api-gateway.skymavis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/graphql/, '/graphql/axie-marketplace'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) proxyReq.setHeader('X-API-Key', apiKey)
            })
          },
        },
      },
    },
  }
})
