// repo-relative paths, resolved from this file so the script runs from anywhere.
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

export const HERE     = dirname(fileURLToPath(import.meta.url))          // precompute/src
export const REPO     = resolve(HERE, '..', '..')                        // repo root
export const GAZETTEER = join(REPO, 'catalog', 'gazetteer')
export const PLACES    = join(GAZETTEER, 'places', 'places.parquet')
export const STATS     = process.env.PRECOMPUTE_STATS || join(GAZETTEER, 'stats')   // overridable for tests
export const CACHE     = join(REPO, 'precompute', '.cache')              // griddap slabs, deleted once aggregated
// the per-chunk daily rows (stats.ts computeOne): the state that makes a full-record run incremental.
// on a runner, point PRECOMPUTE_CHUNKS outside the checkout (actions/checkout cleans ignored files)
export const CHUNKS    = process.env.PRECOMPUTE_CHUNKS || join(CACHE, 'chunks')
// the build machine's private copies of the reference collections (Marine Regions `mr_*`), written by the places
// repo's publish_collections.sh and never published: <slug>/places.parquet at full resolution
export const PLACES_INTERNAL = process.env.PLACES_INTERNAL || join(homedir(), 'data', 'oceanmetrics', 'places-internal')

/** the private places.parquet of a reference collection on this machine, or undefined. */
export const internalParquet = (slug: string, dir: string = PLACES_INTERNAL): string | undefined => {
  const p = join(dir, slug, 'places.parquet')
  return existsSync(p) ? p : undefined
}
