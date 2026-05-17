import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy /api/hyperliquid/* → Hyperliquid directly (dev only, production uses CF Pages Functions)
      '/api/hyperliquid/leaderboard': {
        target: 'https://stats-data.hyperliquid.xyz',
        changeOrigin: true,
        rewrite: () => '/Mainnet/leaderboard',
      },
      '/api/hyperliquid': {
        target: 'https://api.hyperliquid.xyz',
        changeOrigin: true,
        rewrite: () => '/info',
      },
    },
  },
})
