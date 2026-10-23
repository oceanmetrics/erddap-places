// a source host that does not answer is a warning, not a failed run.
//
// the precompute asks three kinds of host for data (PacIOOS `pae-paha.pacioos.hawaii.edu`, our mirror
// `erddap.oceanmetrics.io`, NOAA coastwatch). When one of them times out, drops the connection or answers
// 5xx after the retries of liveExtent() / download() / fetchAxis(), the unit (dataset, variable, place)
// that needed it is SKIPPED: it keeps whatever file it had, nothing partial is written, and the run goes
// on with the units of the other hosts. The skipped units are listed, with the host and the first and last
// failure time, in stats/outage.json (run.ts), which the workflow uploads and prints as a step summary.
// Anything else that fails (a 4xx, a SQL or parse error, a missing place, a bug) is an ERROR and fails the run.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type OutageKind = 'timeout' | 'network' | '5xx'

/** a source host did not answer (timeout, connection error) or answered 5xx, after every retry. */
export class HostOutage extends Error {
  constructor(readonly host: string, readonly kind: OutageKind, message: string, readonly status?: number) {
    super(message)
    this.name = 'HostOutage'
  }
}

// error codes of undici / node sockets that mean "the host could not be reached or hung up"
const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH', 'EHOSTDOWN', 'ENETUNREACH', 'ENETDOWN',
  'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_DESTROYED',
])

/** an error and its `cause` chain. */
function* chain(e: unknown): Generator<unknown> {
  for (let i = 0; i < 5 && e !== undefined && e !== null; i++) { yield e; e = (e as { cause?: unknown }).cause }
}

/** 'timeout' or 'network' when the error is the fetch not reaching the host, else null. */
export function networkKind(e: unknown): 'timeout' | 'network' | null {
  for (const x of chain(e)) {
    const name = (x as { name?: string })?.name, code = (x as { code?: unknown })?.code
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
    if (typeof code === 'string') {
      if (/TIMEOUT|ETIMEDOUT/.test(code)) return 'timeout'
      if (NETWORK_CODES.has(code)) return 'network'
    }
  }
  // undici: "fetch failed" (connect) and "terminated" (the body was cut) are TypeErrors without a code of their own
  if (e instanceof TypeError && /fetch failed|terminated|network/i.test(e.message)) return 'network'
  return null
}

/**
 * the outage a failure is, or null when it is an error: a HostOutage as thrown by liveExtent() and
 * download(), the app's ErddapUnreachable as thrown by fetchAxis() after its retries, or a bare network
 * error that escaped a fetch. `host` names the unit's host when the error does not.
 */
export function outageOf(e: unknown, host: string): HostOutage | null {
  if (e instanceof HostOutage) return e
  if (e instanceof Error && e.name === 'ErddapUnreachable') {
    const x = e as Error & { host: string; reason: string }
    const status = /^HTTP (5\d\d)/.exec(x.reason)?.[1]
    return new HostOutage(x.host || host, status ? '5xx' : /^no response/.test(x.reason) ? 'timeout' : 'network', e.message, status ? Number(status) : undefined)
  }
  const kind = networkKind(e)
  return kind ? new HostOutage(host, kind, e instanceof Error ? e.message : String(e)) : null
}

// ── the report ────────────────────────────────────────────────────────────────
export interface SkippedUnit {
  key          : string                 // dataset/variable/place
  dataset      : string
  variable     : string
  place        : string
  kind         : OutageKind
  status      ?: number                 // the HTTP status of a 5xx
  reason       : string                 // the last failure, first line
  tries        : number                 // failed tries this run (0: never reached, the host was down for the lane)
  first_failure: string                 // ISO UTC
  last_failure : string
}
export interface HostOutageReport {
  host         : string
  kinds        : OutageKind[]
  first_failure: string
  last_failure : string
  units_skipped: SkippedUnit[]
}
export interface OutageFile {
  generated: string
  /** the run's units by outcome, so the file says how much of the run it did not affect */
  units    : { total: number; completed: number; skipped: number; errors: number; deferred: number }
  hosts    : HostOutageReport[]
}

/** group the skipped units by host. */
export function hostReports(skipped: SkippedUnit[], hostOf: (key: string) => string): HostOutageReport[] {
  const by = new Map<string, SkippedUnit[]>()
  for (const s of skipped) {
    const h = hostOf(s.key)
    if (!by.has(h)) by.set(h, [])
    by.get(h)!.push(s)
  }
  return [...by].map(([host, units]) => ({
    host,
    kinds        : [...new Set(units.map((u) => u.kind))].sort(),
    first_failure: units.map((u) => u.first_failure).sort()[0],
    last_failure : units.map((u) => u.last_failure).sort().slice(-1)[0],
    units_skipped: units.sort((a, b) => a.key.localeCompare(b.key)),
  })).sort((a, b) => a.host.localeCompare(b.host))
}

/** write outage.json, or remove a stale one when there is nothing to report (a complete run leaves no file). */
export function writeOutage(file: string, o: OutageFile | null): void {
  if (!o) { rmSync(file, { force: true }); return }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(o, null, 2) + '\n')
}

/** the GitHub step summary of an outage file (markdown). */
export function outageMarkdown(o: OutageFile): string {
  const u = o.units
  const lines = [
    '## Source host outage',
    '',
    `${u.skipped} of ${u.total} unit(s) were skipped because their source host did not answer; ` +
    `${u.completed} completed${u.errors ? `, **${u.errors} failed with an error**` : ''}${u.deferred ? `, ${u.deferred} deferred to the next run` : ''}. ` +
    'A skipped unit keeps its last published file; the next run asks again.',
    '',
    '| host | kind | units skipped | first failure (UTC) | last failure (UTC) |',
    '|------|------|--------------:|---------------------|--------------------|',
    ...o.hosts.map((h) => `| \`${h.host}\` | ${h.kinds.join(', ')} | ${h.units_skipped.length} | ${h.first_failure} | ${h.last_failure} |`),
  ]
  for (const h of o.hosts) {
    lines.push('', `### \`${h.host}\``, '', ...h.units_skipped.map((s) =>
      `- \`${s.key}\`: ${s.reason}${s.tries ? ` (${s.tries} failed ${s.tries === 1 ? 'try' : 'tries'})` : ' (not reached: the host was down for its lane)'}`))
  }
  return lines.join('\n') + '\n'
}

export const outageExists = (file: string) => existsSync(file)
