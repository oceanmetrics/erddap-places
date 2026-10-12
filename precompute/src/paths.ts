// repo-relative paths, resolved from this file so the script runs from anywhere.
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const HERE     = dirname(fileURLToPath(import.meta.url))          // precompute/src
export const REPO     = resolve(HERE, '..', '..')                        // repo root
export const GAZETTEER = join(REPO, 'catalog', 'gazetteer')
export const PLACES    = join(GAZETTEER, 'places', 'places.parquet')
export const STATS     = process.env.PRECOMPUTE_STATS || join(GAZETTEER, 'stats')   // overridable for tests
export const CACHE     = join(REPO, 'precompute', '.cache')              // griddap slabs, deleted once aggregated
// the per-chunk daily rows (stats.ts computeOne): the state that makes a full-record run incremental.
// on a runner, point PRECOMPUTE_CHUNKS outside the checkout (actions/checkout cleans ignored files)
export const CHUNKS    = process.env.PRECOMPUTE_CHUNKS || join(CACHE, 'chunks')
