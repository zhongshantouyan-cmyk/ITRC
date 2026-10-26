import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { legacyToolsPlugin } from '../scripts/legacy-tools.mjs'

export default defineConfig({
    plugins: [react(), legacyToolsPlugin({ repositoryRoot: fileURLToPath(new URL('..', import.meta.url)) })],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
            '/uploads': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            }
        }
    }
})
