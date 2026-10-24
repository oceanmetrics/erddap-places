// publish each (dataset, variable, place) as soon as it is computed, so a run that takes days (or is cut
// off) has already put everything it finished on S3; since 2026-10-24 never a key under stats/dhw_5km/ (NOT_OURS below); the other stats series
// are still published from here. Off unless PRECOMPUTE_PUBLISH names the gazetteer's
// S3 prefix (stats.yml sets s3://oceanmetrics.io-public/gazetteer); the workflow's final sync still runs.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { relative } from 'node:path'
import { GAZETTEER } from './paths'

const CONTENT_TYPES: Record<string, string> = {
  parquet: 'application/vnd.apache.parquet',
  json   : 'application/json',
  png    : 'image/png',
}

// 2026-10-24: gazetteer/stats/dhw_5km/ is the one engine's (oceanmetrics/indicators requests.yml: the compare gate, and
// its `daily` job at 09:30 UTC for the 18 sanctuaries x dhw_5km CRW_SST and CRW_BAA; ledger
// om/plans_todo/2026-10-22_om-restructure_gates.md, week 1). This repo neither writes nor deletes a key under it any
// more: two writers overwrote each other's files on 2026-10-23. The other 18 stats series (cmems_* 15,
// IMERG_monthly_global_precip, moda_npp_mo_glob, noaa_aoml_seascapes_8day) are still computed only here and stay
// published from here until the engine takes them (ledger week 6). The erddap and places catalogs are published here too.
export const NOT_OURS = ['stats/dhw_5km/']

/** the bucket key (relative to the gazetteer prefix) of a local file under catalog/gazetteer/ */
export function keyOf(file: string): string {
  const key = relative(GAZETTEER, file).split('\\').join('/')
  if (key.startsWith('..')) throw new Error(`${file} is not under ${GAZETTEER}`)
  return key
}

/** whether this repo may write `key` (relative to the gazetteer prefix): never one under `NOT_OURS` */
export function isOurs(key: string): boolean {
  return !NOT_OURS.some((p) => key === p.replace(/\/$/, '') || key.startsWith(p))
}

/** `aws s3 cp` arguments for one local file under catalog/gazetteer/, to the same key under `prefix`; refuses a key
 * this repo does not own (`NOT_OURS`). */
export function cpArgs(file: string, prefix: string): string[] {
  const key  = keyOf(file)
  if (!isOurs(key)) throw new Error(`${key}: gazetteer/stats/dhw_5km/ is the engine's since 2026-10-24, not written from here`)
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
    // a file under gazetteer/stats/dhw_5km/ is the engine's (NOT_OURS): skipped and counted, never uploaded
    const ours = files.filter((f) => isOurs(keyOf(f)))
    if (ours.length < files.length) {
      if (!stats.skipped) log(`not uploading under gazetteer/stats/dhw_5km/: the engine's since 2026-10-24 (oceanmetrics/indicators)`)
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
