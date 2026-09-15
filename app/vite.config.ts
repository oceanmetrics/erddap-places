/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// base: './' by default, so the built app works from any path; the Pages workflow sets
// VITE_BASE=/erddap-places/ for the project site (the duckdb-wasm worker + wasm are imported with
// `?url`, so Vite rewrites those URLs to the same base and they still resolve under the sub-path).
// the duckdb-wasm bundles are self-hosted: src/lib/engine.ts imports them with `?url` so Vite copies
// them beside the app; the dep optimizer must not touch the package (it ships its own worker + wasm).
export default defineConfig({
  plugins      : [svelte()],
  base         : process.env.VITE_BASE || './',
  publicDir    : 'static',
  optimizeDeps : { exclude: ['@duckdb/duckdb-wasm'] },
  // vitest otherwise resolves svelte's `ssr` export condition and `mount()` refuses to run:
  // this app only ever runs in a browser, which is the condition vite build already uses
  resolve      : { conditions: ['browser'] },
  build        : { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server       : { port: 5179, strictPort: true, fs: { allow: ['..'] } }, // sql/ lives at the repo root, above app/
  test         : {
    environment : 'node',
    include     : ['src/**/*.test.ts'],
    testTimeout : 120_000,
    // svelte-maplibre imports maplibre-gl's stylesheet: inline it so vite handles the .css, and let
    // the jsdom tests import it at all (node would choke on the extension)
    server      : { deps: { inline: ['svelte-maplibre', /maplibre-gl/] } },
  },
})
