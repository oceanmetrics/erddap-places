/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'
import { createReadStream, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// dev only: the then-now fixture (src/lib/thenNow/fixtures) served at /__then-now-fixture/ with Range
// support, so `#mode=then-now&place=NMS:TEST&data=/__then-now-fixture/` runs offline. Vite's own
// file serving cannot do it: its allow-list check answers 403 to the colon in `NMS:TEST`.
const FIXTURE_ROOT = fileURLToPath(new URL('./src/lib/thenNow/fixtures', import.meta.url))
const thenNowFixture = (): Plugin => ({
  name: 'then-now-fixture',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__then-now-fixture/', (req, res, next) => {
      const file = resolve(FIXTURE_ROOT, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]))
      if (!file.startsWith(FIXTURE_ROOT + sep)) return next()
      let size: number
      try { size = statSync(file).size } catch { res.statusCode = 404; return res.end() }
      const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''))
      res.setHeader('Accept-Ranges', 'bytes')
      if (m) {
        const a = Number(m[1]), b = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1)
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${a}-${b}/${size}`)
        res.setHeader('Content-Length', String(b - a + 1))
        return createReadStream(file, { start: a, end: b }).pipe(res)
      }
      res.setHeader('Content-Length', String(size))
      createReadStream(file).pipe(res)
    })
  },
})

// base: './' by default, so the built app works from any path; the Pages workflow sets
// VITE_BASE=/erddap-places/ for the project site (the duckdb-wasm worker + wasm are imported with
// `?url`, so Vite rewrites those URLs to the same base and they still resolve under the sub-path).
// the duckdb-wasm bundles are self-hosted: src/lib/engine.ts imports them with `?url` so Vite copies
// them beside the app; the dep optimizer must not touch the package (it ships its own worker + wasm).
export default defineConfig({
  plugins      : [svelte(), thenNowFixture()],
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
