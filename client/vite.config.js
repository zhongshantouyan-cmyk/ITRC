import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { legacyToolsPlugin } from '../scripts/legacy-tools.mjs'
import { releaseManifestPlugin } from '../scripts/release-manifest.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
    plugins: [react(), legacyToolsPlugin({ repositoryRoot }), releaseManifestPlugin({ repositoryRoot })],
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
