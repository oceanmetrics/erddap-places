// run the units through the per-server scheduler and sort what happened to each into one of five outcomes:
//
//   completed  the unit's file is whole and published
//   skipped    its source host did not answer (timeout, connection error, 5xx after the retries: outage.ts).
//              The unit keeps the file it had; nothing partial is written. A WARNING, never a failure.
//   error      anything else: a 4xx, a SQL or parse error, a missing place, a bug. Fails the run.
//   deferred   not started, or stopped, at the deadline; resumes next run
//
// The rule for the exit code: 1 when any unit ended in `error`, else 0, even when every unit was skipped
// because its host was down. Skipped units are written to outage.json (beside the stats) with the host and the
// first and last failure time; a run with no skipped unit writes no file and removes a stale one.
import { schedule, type Outcome, type Unit, type ScheduleOpts } from './schedule'
import { hostReports, outageOf, writeOutage, type OutageFile, type OutageKind, type SkippedUnit } from './outage'

export interface RunUnit extends Unit { dataset: string; variable: string; place_id: string }
export type UnitStatus = 'completed' | 'skipped' | 'error' | 'deferred'

/** what became of one (dataset, variable, place). `answered`: did its source host answer (null: never asked). */
export interface UnitRecord {
  key     : string
  host    : string
  dataset : string
  variable: string
  place   : string
  status  : UnitStatus
  answered: boolean | null
  reason ?: string
}

export interface RunOpts<U extends RunUnit> {
  compute    : (u: U, attempt: number, progress: () => void) => Promise<Outcome>
  /** where outage.json goes (stats/outage.json) */
  outageFile : string
  deadline  ?: number
  now       ?: () => number
  wait      ?: ScheduleOpts<U>['wait']
  restMs    ?: number[]
  maxAttempts?: number
  log       ?: (s: string) => void
}

export interface RunReport {
  units   : UnitRecord[]
  outage  : OutageFile | null
  /** 0, or 1 when a unit ended in `error` */
  exitCode: 0 | 1
}

interface Failures { first: number; last: number; tries: number; kind: OutageKind }
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]

export async function runUnits<U extends RunUnit>(units: U[], o: RunOpts<U>): Promise<RunReport> {
  const now = o.now ?? Date.now
  writeOutage(o.outageFile, null)                         // a stale file from an earlier run is never this run's
  const fails = new Map<string, Failures>()               // outage failures per unit
  const hostFails = new Map<string, { first: number; last: number; kind: OutageKind }>()
  const lastOf = new Map<string, 'ok' | 'outage' | 'error'>()   // the latest thing each host did

  const res = await schedule(units, {
    deadline: o.deadline, now, wait: o.wait, restMs: o.restMs, maxAttempts: o.maxAttempts, log: o.log,
    run: async (u, attempt, progress) => {
      try {
        const out = await o.compute(u, attempt, progress)
        lastOf.set(u.host, 'ok')
        return out
      } catch (e) {
        const out = outageOf(e, u.host)
        lastOf.set(u.host, out ? 'outage' : 'error')
        if (out) {
          const t = now()
          const f = fails.get(u.key)
          fails.set(u.key, { first: f?.first ?? t, last: t, tries: (f?.tries ?? 0) + 1, kind: out.kind })
          const h = hostFails.get(u.host)
          hostFails.set(u.host, { first: h?.first ?? t, last: t, kind: out.kind })
        }
        throw e
      }
    },
  })

  const records = new Map<string, UnitRecord>()
  const base = (u: U): UnitRecord => ({ key: u.key, host: u.host, dataset: u.dataset, variable: u.variable, place: u.place_id, status: 'completed', answered: true })
  for (const u of units) records.set(u.key, { ...base(u), status: 'deferred', answered: null })
  for (const u of res.done) records.set(u.key, base(u))
  const skipped: SkippedUnit[] = []
  const skip = (u: U, reason: string, kind: OutageKind, tries: number, f: { first: number; last: number }, status?: number) => {
    records.set(u.key, { ...base(u), status: 'skipped', answered: false, reason })
    skipped.push({ key: u.key, dataset: u.dataset, variable: u.variable, place: u.place_id, kind, ...(status ? { status } : {}),
                   reason, tries, first_failure: iso(f.first), last_failure: iso(f.last) })
  }
  for (const f of res.failed) {
    const out = outageOf(f.cause, f.unit.host)
    const fl = fails.get(f.unit.key)
    if (out && fl) skip(f.unit, firstLine(f.cause), out.kind, fl.tries, fl, out.status)
    else records.set(f.unit.key, { ...base(f.unit), status: 'error', answered: true, reason: f.error })
  }
  // left in the queue at the deadline: a unit of a host that was still down was not reached because of the
  // outage; a unit of a healthy host is simply deferred to the next run
  for (const u of res.deferred) {
    const h = hostFails.get(u.host)
    if (h && lastOf.get(u.host) === 'outage') {
      const fl = fails.get(u.key)
      skip(u, fl ? 'host still down at the deadline' : 'not reached: host still down at the deadline', fl?.kind ?? h.kind, fl?.tries ?? 0, fl ?? h)
    }
  }

  const all = [...records.values()]
  const count = (s: UnitStatus) => all.filter((r) => r.status === s).length
  const hostOfKey = new Map(all.map((r) => [r.key, r.host]))
  const outage: OutageFile | null = skipped.length ? {
    generated: iso(now()),
    units    : { total: all.length, completed: count('completed'), skipped: count('skipped'), errors: count('error'), deferred: count('deferred') },
    hosts    : hostReports(skipped, (k) => hostOfKey.get(k)!),
  } : null
  writeOutage(o.outageFile, outage)
  return { units: all, outage, exitCode: count('error') ? 1 : 0 }
}
