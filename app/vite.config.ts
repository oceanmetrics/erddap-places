/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// base './' so the built app works from any path (a GitHub Pages project site).
// the duckdb-wasm bundles are self-hosted: src/lib/engine.ts imports them with `?url` so Vite copies
// them beside the app; the dep optimizer must not touch the package (it ships its own worker + wasm).
export default defineConfig({
  plugins      : [svelte()],
  base         : './',
  publicDir    : 'static',
  optimizeDeps : { exclude: ['@duckdb/duckdb-wasm'] },
  build        : { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server       : { port: 5179, strictPort: true, fs: { allow: ['..'] } }, // sql/ lives at the repo root, above app/
  test         : {
    environment : 'node',
    include     : ['src/**/*.test.ts'],
    testTimeout : 120_000,
  },
})
