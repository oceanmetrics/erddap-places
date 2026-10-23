// a polite scheduler for the precompute's (dataset, variable, place) units.
//
// one lane per ERDDAP server, the lanes running side by side, so a slow or overloaded server never
// holds up the others. In a lane the units run one after another. A unit that fails goes to the back of
// its lane and the server rests (REST_MS, longer after each consecutive failure, reset by a success)
// before its lane asks it for anything again: an overloaded server gets a break instead of more
// requests, and the next place, or the next dataset on that server, is tried after the rest. A unit is
// given up for this run after MAX_ATTEMPTS tries in a row that made no progress (its finished chunks stay
// for the next run). A try that finished chunks before it failed (`progress()`) resets that count and the
// server's back-off: a long backfill (NMS:PMNM's 1985-on daily CRW, one request a day) that PacIOOS serves
// for a while and then refuses keeps going after a 10 min rest until the deadline, instead of stopping
// for the day after three such tries (2026-10-19). No unit starts after the deadline; the units left, and
// one stopped mid-way, are reported as deferred.
import { MAX_ATTEMPTS, REST_MS } from './targets'

export interface Unit { key: string; host: string }
export type Outcome = 'done' | 'deferred'

export interface ScheduleOpts<U extends Unit> {
  /**
   * computes one unit: resolves 'done', or 'deferred' when it stopped at the deadline; throws on failure.
   * it calls `progress()` whenever it finishes a piece that a later try will not redo (a chunk).
   */
  run         : (u: U, attempt: number, progress: () => void) => Promise<Outcome>
  restMs     ?: number[]
  maxAttempts?: number
  deadline   ?: number                                   // epoch ms
  now        ?: () => number
  wait       ?: (ms: number) => Promise<unknown>
  log        ?: (s: string) => void
}

export interface ScheduleResult<U extends Unit> {
  done    : U[]
  deferred: U[]
  failed  : Array<{ unit: U; error: string; cause: unknown }>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]

/** the lane a URL belongs to: its host. */
export const hostOf = (url: string) => { try { return new URL(url).host } catch { return url } }

export async function schedule<U extends Unit>(units: U[], o: ScheduleOpts<U>): Promise<ScheduleResult<U>> {
  const restMs      = o.restMs ?? REST_MS
  const maxAttempts = o.maxAttempts ?? MAX_ATTEMPTS
  const deadline    = o.deadline ?? Infinity
  const now         = o.now ?? Date.now
  const wait        = o.wait ?? sleep
  const log         = o.log ?? console.log
  const res: ScheduleResult<U> = { done: [], deferred: [], failed: [] }

  // tries: every try of the unit this run; stuck: the tries in a row that made no progress
  type Entry = { u: U; tries: number; stuck: number }
  const lanes = new Map<string, Entry[]>()
  for (const u of units) {
    if (!lanes.has(u.host)) lanes.set(u.host, [])
    lanes.get(u.host)!.push({ u, tries: 0, stuck: 0 })
  }

  const lane = async (host: string, queue: Entry[]) => {
    let strikes = 0
    while (queue.length) {
      if (now() >= deadline) { res.deferred.push(...queue.map((q) => q.u)); return }
      const q = queue.shift()!
      let pieces = 0
      try {
        const out = await o.run(q.u, ++q.tries, () => { pieces++ })
        res[out === 'deferred' ? 'deferred' : 'done'].push(q.u)
        strikes = 0
      } catch (e) {
        if (pieces) { q.stuck = 0; strikes = 0 } else q.stuck++
        const note = pieces ? `try ${q.tries}, ${pieces} piece(s) done first` : `try ${q.tries}, ${q.stuck}/${maxAttempts} in a row with no progress`
        if (q.stuck >= maxAttempts) {
          res.failed.push({ unit: q.u, error: message(e), cause: e })
          log(`!! ${q.u.key}: ${message(e)} (${note}; given up for this run)`)
        } else {
          queue.push(q)
          log(`!! ${q.u.key}: ${message(e)} (${note}; back of the ${host} queue)`)
        }
        if (!queue.length) break
        const ms = Math.min(restMs[Math.min(strikes, restMs.length - 1)], Math.max(0, deadline - now()))
        strikes++
        log(`.. ${host} rests ${Math.round(ms / 60_000)} min (${strikes} failure(s) in a row), ${queue.length} unit(s) waiting`)
        await wait(ms)
      }
    }
  }

  log(`${units.length} unit(s) on ${lanes.size} server(s): ${[...lanes].map(([h, q]) => `${h} ${q.length}`).join(', ')}`)
  await Promise.all([...lanes].map(([h, q]) => lane(h, q)))
  return res
}
