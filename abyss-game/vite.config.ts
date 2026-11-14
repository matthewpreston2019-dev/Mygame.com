/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ARTIFACT=1 builds a single self-contained page for hosting as a web artifact.
const artifact = process.env.ARTIFACT === '1'

export default defineConfig({
  // Relative paths let the same build run from any subfolder (e.g. GitHub Pages).
  base: process.env.BASE_PATH ?? (artifact ? './' : '/'),
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    assetsInlineLimit: artifact ? 100_000_000 : 4096,
    cssCodeSplit: !artifact,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        ...(artifact
          ? { inlineDynamicImports: true }
          : {
              manualChunks: {
                react: ['react', 'react-dom'],
                motion: ['framer-motion'],
              },
            }),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
