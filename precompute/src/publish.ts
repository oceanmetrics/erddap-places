// publish each (dataset, variable, place) as soon as it is computed, so a run that takes days (or is cut
// off) has already put everything it finished on S3; since 2026-10-24 never a key of an engine series (NOT_OURS below); the other stats series
// are still published from here. Off unless PRECOMPUTE_PUBLISH names the gazetteer's
// S3 prefix (stats.yml sets s3://oceanmetrics.io-public/gazetteer); the workflow's final sync still runs.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { relative } from 'node:path'
import { GAZETTEER } from './paths'
import { ENGINE_SERIES } from './targets'

const CONTENT_TYPES: Record<string, string> = {
  parquet: 'application/vnd.apache.parquet',
  json   : 'application/json',
  png    : 'image/png',
}

// 2026-10-24: a series the one engine owns (targets.ts ENGINE_SERIES: dhw_5km CRW_SST and CRW_BAA since week 1, the others
// as week 6 moves them; oceanmetrics/indicators requests.yml, the compare gate and its `daily` job; ledger
// om/plans_todo/2026-10-22_om-restructure_gates.md) is neither written nor deleted from here: not its files under
// stats/<dataset>/<variable>/, not its STAC Items stats/items/<dataset>_<variable>_*.json (the daily job fetches every
// published Item from S3, so its sync would put the engine's Items back). Two writers overwrote each other's files on
// 2026-10-23. collection.json is still built here (stac.ts, it lists every Item) until the last series moves.
export const NOT_OURS: string[] = ENGINE_SERIES.flatMap(([d, v]) => [`stats/${d}/${v}/`, `stats/items/${d}_${v}_`])

/** the `aws s3 sync --exclude` patterns, relative to gazetteer/stats/, of every NOT_OURS prefix (stats.yml, ci.ts). */
export function syncExcludes(): string[] {
  return NOT_OURS.map((p) => `${p.replace(/^stats\//, '')}*`)
}

const ENGINE_NAMES = ENGINE_SERIES.map(([d, v]) => `${d}/${v}`).join(', ')

/** the bucket key (relative to the gazetteer prefix) of a local file under catalog/gazetteer/ */
export function keyOf(file: string): string {
  const key = relative(GAZETTEER, file).split('\\').join('/')
  if (key.startsWith('..')) throw new Error(`${file} is not under ${GAZETTEER}`)
  return key
}

/** whether this repo may write `key` (relative to the gazetteer prefix): never one under `NOT_OURS` */
export function isOurs(key: string): boolean {
  return !NOT_OURS.some((p) => (p.endsWith('/') && key === p.slice(0, -1)) || key.startsWith(p))
}

/** `aws s3 cp` arguments for one local file under catalog/gazetteer/, to the same key under `prefix`; refuses a key
 * this repo does not own (`NOT_OURS`). */
export function cpArgs(file: string, prefix: string): string[] {
  const key  = keyOf(file)
  if (!isOurs(key)) throw new Error(`${key}: the engine's (${ENGINE_NAMES}; oceanmetrics/indicators), not written from here`)
  const type = CONTENT_TYPES[file.split('.').pop() ?? '']
  return ['s3', 'cp', file, `${prefix.replace(/\/+$/, '')}/${key}`, '--only-show-errors',
          ...(type ? ['--content-type', type] : [])]
}

type Exec = (cmd: string, args: string[]) => Promise<unknown>

/**
 * a publisher: `publish(files)` uploads them in order, one upload at a time across the whole run (the
 * lanes finish items concurrently; collection.json must land after the files it links). A failed upload
 * is logged and counted, never thrown: the computed files stay on disk for the final sync.
 */
export function publisher(prefix = process.env.PRECOMPUTE_PUBLISH ?? '', exec: Exec = promisify(execFile),
                          log: (s: string) => void = console.log) {
  let chain: Promise<unknown> = Promise.resolve()
  const stats = { files: 0, failures: 0, skipped: 0 }
  const publish = (files: string[]) => {
    if (!prefix) return Promise.resolve()
    // a file or Item of an engine series is the engine's (NOT_OURS): skipped and counted, never uploaded
    const ours = files.filter((f) => isOurs(keyOf(f)))
    if (ours.length < files.length) {
      log(`not uploading ${files.length - ours.length} file(s) of the engine's series (${ENGINE_NAMES}; oceanmetrics/indicators)`)
      stats.skipped += files.length - ours.length
    }
    chain = chain.then(async () => {
      for (const f of ours) {
        try { await exec('aws', cpArgs(f, prefix)); stats.files++ }
        catch (e) { stats.failures++; log(`!! upload ${relative(GAZETTEER, f)}: ${e instanceof Error ? e.message.split('\n')[0] : e}`) }
      }
    })
    return chain
  }
  return { publish, stats, enabled: !!prefix, done: () => chain }
}
