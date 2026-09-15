// repo-relative paths, resolved from this file so the script runs from anywhere.
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const HERE     = dirname(fileURLToPath(import.meta.url))          // precompute/src
export const REPO     = resolve(HERE, '..', '..')                        // repo root
export const GAZETTEER = join(REPO, 'catalog', 'gazetteer')
export const PLACES    = join(GAZETTEER, 'places', 'places.parquet')
export const STATS     = join(GAZETTEER, 'stats')
export const CACHE     = join(REPO, 'precompute', '.cache')              // downloaded griddap slabs
