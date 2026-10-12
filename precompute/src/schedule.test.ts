// the polite side of the precompute, offline: which chunks a run fetches (planChunks), how the units are
// scheduled per server (schedule), and what a per-item upload runs (publish cpArgs).
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { planChunks } from './stats'
import { schedule, hostOf, type Unit } from './schedule'
import { cpArgs, publisher } from './publish'
import { GAZETTEER } from './paths'

const win = { start: '2026-01-01', end: '2026-04-17' }

describe('planChunks', () => {
  it('slices the whole window when nothing is done', () => {
    const p = planChunks(win, 90, [])
    expect(p.todo).toEqual([['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-04-17']])
    expect(p.keep).toEqual([])
    expect(p.supersede).toBeNull()
  })
  it("refetches last run's short last chunk to the new end, from its own start", () => {
    const p = planChunks(win, 90, ['2026-01-01_2026-03-31.parquet', '2026-04-01_2026-04-10.parquet'])
    expect(p.keep).toEqual([['2026-01-01', '2026-03-31']])
    expect(p.todo).toEqual([['2026-04-01', '2026-04-17']])
    expect(p.supersede).toBe('2026-04-01_2026-04-10.parquet')
  })
  it('keeps chunks cut at another size: only the gaps are sliced, at the new size', () => {
    // 50-day chunks from the 2 M-value cap; the new cap gives 20-day chunks
    const p = planChunks(win, 20, ['2026-01-01_2026-02-19.parquet', '2026-02-20_2026-04-10.parquet'])
    expect(p.keep).toEqual([['2026-01-01', '2026-02-19'], ['2026-02-20', '2026-04-10']])
    expect(p.todo).toEqual([['2026-04-11', '2026-04-17']])
    expect(p.supersede).toBeNull()                                  // a 50-day chunk is not short at 20 d
  })
  it('fills a hole in the middle (a chunk lost or never fetched)', () => {
    const p = planChunks(win, 30, ['2026-01-01_2026-01-30.parquet', '2026-03-02_2026-03-31.parquet', '2026-04-01_2026-04-17.parquet'])
    expect(p.todo).toEqual([['2026-01-31', '2026-03-01']])
  })
  it('drops files outside the window and files that are not chunks', () => {
    const p = planChunks(win, 90, ['2025-12-01_2025-12-31.parquet', 'notes.parquet', '2026-01-01_2026-04-17.parquet'])
    expect(p.drop).toEqual(['2025-12-01_2025-12-31.parquet', 'notes.parquet'])
    expect(p.todo).toEqual([])
  })
})

// a fake clock: wait() advances it, so rests take no real time. It yields to the other lanes first, as a
// real timer does: a lane that is not waiting runs before the shared clock moves on
function clock() {
  let t = 0
  const wait = async (ms: number) => { await new Promise((r) => setTimeout(r, 0)); t += ms }
  return { now: () => t, wait, at: () => t }
}
const u = (key: string, host: string): Unit => ({ key, host })

describe('schedule', () => {
  it('rests a failing server and moves on to its next place; the other server never waits', async () => {
    const c = clock(), order: string[] = []
    let flaky = 0
    const res = await schedule([u('a1', 'pacioos'), u('a2', 'pacioos'), u('b1', 'cmems'), u('b2', 'cmems')], {
      ...c, restMs: [600_000], log: () => {},
      run: async (x) => {
        order.push(`${x.key}@${c.at() / 60_000}`)
        if (x.key === 'a1' && flaky++ === 0) throw new Error('fetch failed')
        return 'done'
      },
    })
    // a1 fails at t=0, the pacioos lane rests 10 min, a2 runs, then a1 again; cmems ran at t=0 throughout
    expect(order).toEqual(['a1@0', 'b1@0', 'b2@0', 'a2@10', 'a1@10'])
    expect(res.done.map((x) => x.key).sort()).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(res.failed).toEqual([])
  })
  it('backs off longer after consecutive failures, and gives a unit up after MAX_ATTEMPTS', async () => {
    const c = clock(), at: number[] = []
    const res = await schedule([u('a1', 'h'), u('a2', 'h')], {
      ...c, restMs: [10, 30, 60].map((m) => m * 60_000), maxAttempts: 2, log: () => {},
      run: async () => { at.push(c.at() / 60_000); throw new Error('503 Service Unavailable') },
    })
    expect(at).toEqual([0, 10, 40, 100])                            // rests 10, 30, 60 between the four tries
    expect(res.failed.map((f) => [f.unit.key, f.error])).toEqual([['a1', '503 Service Unavailable'], ['a2', '503 Service Unavailable']])
  })
  it('starts nothing after the deadline: the rest is deferred, as is a unit stopped mid-way', async () => {
    const c = clock()
    const res = await schedule([u('a1', 'h'), u('a2', 'h'), u('a3', 'h')], {
      ...c, deadline: 60_000, log: () => {},
      run: async (x) => { await c.wait(45_000); return x.key === 'a2' ? 'deferred' : 'done' },
    })
    expect(res.done.map((x) => x.key)).toEqual(['a1'])
    expect(res.deferred.map((x) => x.key)).toEqual(['a2', 'a3'])
  })
  it('never rests past the deadline', async () => {
    const c = clock()
    const res = await schedule([u('a1', 'h'), u('a2', 'h')], {
      ...c, deadline: 5 * 60_000, restMs: [60 * 60_000], log: () => {},
      run: async () => { throw new Error('fetch failed') },
    })
    expect(c.at()).toBe(5 * 60_000)
    expect(res.deferred.map((x) => x.key).sort()).toEqual(['a1', 'a2'])
  })
  it('lanes are servers', () => {
    expect(hostOf('https://pae-paha.pacioos.hawaii.edu/erddap')).toBe('pae-paha.pacioos.hawaii.edu')
  })
})

describe('publish', () => {
  it('uploads a file to the same key under the prefix, colon and all, with its content type', () => {
    const f = join(GAZETTEER, 'stats', 'dhw_5km', 'CRW_SST', 'NMS:FKNMS.parquet')
    expect(cpArgs(f, 's3://oceanmetrics.io-public/gazetteer/')).toEqual([
      's3', 'cp', f, 's3://oceanmetrics.io-public/gazetteer/stats/dhw_5km/CRW_SST/NMS:FKNMS.parquet',
      '--only-show-errors', '--content-type', 'application/vnd.apache.parquet'])
  })
  it('uploads in order, one at a time, and counts a failure without throwing', async () => {
    const calls: string[] = []
    const exec = async (_: string, a: string[]) => { calls.push(a[3].split('/').pop()!); if (a[3].endsWith('bad.json')) throw new Error('AccessDenied') }
    const p = publisher('s3://b/gazetteer', exec, () => {})
    const at = (f: string) => join(GAZETTEER, 'stats', f)
    void p.publish([at('x.parquet'), at('bad.json')])
    void p.publish([at('collection.json')])
    await p.done()
    expect(calls).toEqual(['x.parquet', 'bad.json', 'collection.json'])
    expect(p.stats).toEqual({ files: 2, failures: 1 })
  })
  it('does nothing without a prefix', async () => {
    const p = publisher('', async () => { throw new Error('should not run') }, () => {})
    await p.publish([join(GAZETTEER, 'stats', 'x.parquet')])
    expect(p.enabled).toBe(false)
  })
})
