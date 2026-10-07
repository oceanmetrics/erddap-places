#!/usr/bin/env node
// the size budget of the built app (run after `npm run build`): what a first view downloads before
// any data, gzipped, against a budget per part. DuckDB's wasm and worker are fetched on first query
// and are listed, not budgeted (they are the engine, pinned at 1.29.0); fonts are fetched on use.
//
//   node scripts/size-budget.mjs [--dist dist]
//
// budgets set 2026-10-08 with the MBON re-layout (@marinebon/ui 0.1.0); see README "Size budget".
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const KB = 1024
export const BUDGET = {
  entryJs : 620 * KB,   // index-*.js: Svelte, MapLibre, Plot, DuckDB glue, hyparquet, the kit, the app
  css     :  20 * KB,   // index-*.css: MapLibre + the kit's tokens/base + app
  thenNow :  40 * KB,   // the lazy Then vs Now chunk (geotiff readers load on their own)
  fonts   : 560 * KB,   // every self-hosted woff2 (a page fetches only the faces it uses)
}

const dist = process.argv.includes('--dist') ? process.argv[process.argv.indexOf('--dist') + 1] : 'dist'
const files = readdirSync(join(dist, 'assets'))
const gz = (f) => gzipSync(readFileSync(join(dist, 'assets', f))).length
const raw = (f) => readFileSync(join(dist, 'assets', f)).length
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0)
const pick = (re) => files.filter((f) => re.test(f))

const parts = [
  { name: 'entry JS (gzip)', files: pick(/^index-.*\.js$/), size: gz, budget: BUDGET.entryJs },
  { name: 'entry CSS (gzip)', files: pick(/^index-.*\.css$/), size: gz, budget: BUDGET.css },
  { name: 'Then vs Now chunk JS+CSS (gzip)', files: pick(/^ThenNow-.*\.(js|css)$/), size: gz, budget: BUDGET.thenNow },
  { name: 'fonts (woff2, raw)', files: pick(/\.woff2$/), size: raw, budget: BUDGET.fonts },
]
let ok = true
for (const p of parts) {
  const n = sum(p.files, p.size)
  const pass = n <= p.budget
  ok &&= pass
  console.log(`${pass ? 'ok  ' : 'OVER'} ${p.name}: ${(n / KB).toFixed(1)} KB (budget ${(p.budget / KB).toFixed(0)} KB) ${p.files.join(', ')}`)
}
const engine = pick(/^duckdb-/)
console.log(`info DuckDB engine (fetched on first query, not budgeted): ${(sum(engine, gz) / KB).toFixed(0)} KB gzip`)
if (!ok) { console.error('size-budget: FAIL'); process.exit(1) }
console.log('size-budget: PASS')
