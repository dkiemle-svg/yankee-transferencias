import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// base './' funciona no GitHub Pages (https://usuario.github.io/repositorio/)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', chunkSizeWarningLimit: 1500 },
}))
