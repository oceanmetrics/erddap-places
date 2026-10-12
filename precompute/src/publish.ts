// publish each (dataset, variable, place) as soon as it is computed, so a run that takes days (or is cut
// off) has already put everything it finished on S3. Off unless PRECOMPUTE_PUBLISH names the gazetteer's
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

/** `aws s3 cp` arguments for one local file under catalog/gazetteer/, to the same key under `prefix`. */
export function cpArgs(file: string, prefix: string): string[] {
  const key  = relative(GAZETTEER, file).split('\\').join('/')
  if (key.startsWith('..')) throw new Error(`${file} is not under ${GAZETTEER}`)
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
  const stats = { files: 0, failures: 0 }
  const publish = (files: string[]) => {
    if (!prefix) return Promise.resolve()
    chain = chain.then(async () => {
      for (const f of files) {
        try { await exec('aws', cpArgs(f, prefix)); stats.files++ }
        catch (e) { stats.failures++; log(`!! upload ${relative(GAZETTEER, f)}: ${e instanceof Error ? e.message.split('\n')[0] : e}`) }
      }
    })
    return chain
  }
  return { publish, stats, enabled: !!prefix, done: () => chain }
}
