// the polite side of the precompute, offline: which chunks a run fetches (planChunks), how the units are
// scheduled per server (schedule), and what a per-item upload runs (publish cpArgs).
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { planChunks } from './stats'
import { schedule, hostOf, type Unit } from './schedule'
import { cpArgs, isOurs, publisher, syncExcludes, NOT_OURS } from './publish'
import { ENGINE_SERIES } from './targets'
import { readFileSync } from 'node:fs'
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
  it('keeps a unit that progresses before it fails going until the deadline, after the shortest rest', async () => {
    const c = clock(), at: number[] = []
    let left = 10                                                   // chunks to fetch; each try finishes 2, then a 503
    const res = await schedule([u('pmnm', 'pacioos')], {
      ...c, restMs: [10, 30, 60].map((m) => m * 60_000), maxAttempts: 2, log: () => {},
      run: async (_x, _a, progress) => {
        at.push(c.at() / 60_000)
        for (let i = 0; i < 2 && left; i++) { left--; progress() }
        if (left) throw new Error('503 Service Unavailable')
        return 'done'
      },
    })
    expect(at).toEqual([0, 10, 20, 30, 40])                         // 5 tries (> maxAttempts), 10 min apart: no back-off growth
    expect(res.done.map((x) => x.key)).toEqual(['pmnm'])
    expect(res.failed).toEqual([])
  })
  it('gives a unit up after MAX_ATTEMPTS tries in a row with no progress, counted from its last progress', async () => {
    const c = clock()
    let n = 0
    const res = await schedule([u('a1', 'h')], {
      ...c, restMs: [60_000], maxAttempts: 2, log: () => {},
      run: async (_x, _a, progress) => { if (n++ === 1) progress(); throw new Error('fetch failed') },
    })
    expect(n).toBe(4)                                               // no progress, progress (resets), no progress, no progress
    expect(res.failed.map((f) => f.unit.key)).toEqual(['a1'])
  })
  it('still stops a progressing unit at the deadline (deferred, not failed)', async () => {
    const c = clock()
    const res = await schedule([u('a1', 'h')], {
      ...c, deadline: 35 * 60_000, restMs: [10 * 60_000], maxAttempts: 2, log: () => {},
      run: async (_x, _a, progress) => { progress(); throw new Error('503') },
    })
    expect(c.at()).toBe(35 * 60_000)
    expect(res.deferred.map((x) => x.key)).toEqual(['a1'])
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
  it('hands the last error of a given-up unit to the caller, so the run can tell an outage from an error', async () => {
    const boom = new Error('503 Service Unavailable')
    const res = await schedule([u('a1', 'h')], { ...clock(), restMs: [1], maxAttempts: 1, log: () => {}, run: async () => { throw boom } })
    expect(res.failed[0].cause).toBe(boom)
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
    const f = join(GAZETTEER, 'places', 'NMS:FKNMS.parquet')
    expect(cpArgs(f, 's3://oceanmetrics.io-public/gazetteer/')).toEqual([
      's3', 'cp', f, 's3://oceanmetrics.io-public/gazetteer/places/NMS:FKNMS.parquet',
      '--only-show-errors', '--content-type', 'application/vnd.apache.parquet'])
  })
  it('uploads in order, one at a time, and counts a failure without throwing', async () => {
    const calls: string[] = []
    const exec = async (_: string, a: string[]) => { calls.push(a[3].split('/').pop()!); if (a[3].endsWith('bad.json')) throw new Error('AccessDenied') }
    const p = publisher('s3://b/gazetteer', exec, () => {})
    const at = (f: string) => join(GAZETTEER, 'erddap', 'x', f)
    void p.publish([at('x.parquet'), at('bad.json')])
    void p.publish([at('collection.json')])
    await p.done()
    expect(calls).toEqual(['x.parquet', 'bad.json', 'collection.json'])
    expect(p.stats).toEqual({ files: 2, failures: 1, skipped: 0 })
  })
  // 2026-10-24 (ledger week 1, week 6): a series the one engine owns (targets.ts ENGINE_SERIES: dhw_5km CRW_SST and
  // CRW_BAA so far; oceanmetrics/indicators requests.yml) is never written from here, neither its files nor its STAC
  // Items under stats/items/ (the daily job fetches the published Items from S3 and its sync would put them back:
  // regression, the engine's dhw_5km Items); the other stats series are still this repo's until the engine takes them
  it('NOT_OURS is every engine series\' directory and Item prefix', () => {
    // week 1: dhw_5km; week 6, series by series (oceanmetrics/indicators scripts/parity_units.tsv)
    expect(ENGINE_SERIES.slice(0, 3)).toEqual([['dhw_5km', 'CRW_SST'], ['dhw_5km', 'CRW_BAA'],
                                               ['IMERG_monthly_global_precip', 'precipitation']])
    expect(NOT_OURS).toEqual(ENGINE_SERIES.flatMap(([d, v]) => [`stats/${d}/${v}/`, `stats/items/${d}_${v}_`]))
    expect(NOT_OURS.slice(0, 2)).toEqual(['stats/dhw_5km/CRW_SST/', 'stats/items/dhw_5km_CRW_SST_'])
    expect(syncExcludes()).toEqual(ENGINE_SERIES.flatMap(([d, v]) => [`${d}/${v}/*`, `items/${d}_${v}_*`]))
    expect(syncExcludes()).toContain('items/IMERG_monthly_global_precip_precipitation_*')
  })
  it('never uploads an engine series\' file or Item and still uploads another stats key', async () => {
    const calls: string[] = []
    const logs: string[] = []
    const p = publisher('s3://b/gazetteer', async (_: string, a: string[]) => { calls.push(a[3]) }, (s) => logs.push(s))
    const st = (f: string) => join(GAZETTEER, 'stats', f)
    void p.publish([st('dhw_5km/CRW_SST/NMS:CINMS.parquet'), st('dhw_5km/CRW_BAA/NMS:CINMS.provenance.json'),
                    st('items/dhw_5km_CRW_SST_NMS-CINMS.json'), st('items/dhw_5km_CRW_BAA_NMS-PMNM.json'),
                    st('IMERG_monthly_global_precip/precipitation/NMS:CINMS.parquet'),
                    st('items/IMERG_monthly_global_precip_precipitation_NMS-CINMS.json'),
                    st('cmems_salinity/so/NMS:CINMS.parquet'), st('moda_npp_mo_glob/npp/NMS:CINMS.parquet'),
                    st('items/cmems_salinity_so_NMS-CINMS.json'), st('collection.json')])
    void p.publish([join(GAZETTEER, 'erddap', 'dhw_5km', 'collection.json')])
    await p.done()
    expect(calls).toEqual(['s3://b/gazetteer/stats/cmems_salinity/so/NMS:CINMS.parquet',
                           's3://b/gazetteer/stats/moda_npp_mo_glob/npp/NMS:CINMS.parquet',
                           's3://b/gazetteer/stats/items/cmems_salinity_so_NMS-CINMS.json',
                           's3://b/gazetteer/stats/collection.json',
                           's3://b/gazetteer/erddap/dhw_5km/collection.json'])
    expect(calls.some((c) => c.includes('dhw_5km_') || c.includes('/stats/dhw_5km/'))).toBe(false)
    expect(calls.some((c) => c.includes('IMERG'))).toBe(false)
    expect(p.stats).toEqual({ files: 5, failures: 0, skipped: 6 })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/^not uploading 6 file\(s\) of the engine's series \(dhw_5km\/CRW_SST, dhw_5km\/CRW_BAA, IMERG_monthly_global_precip\/precipitation/)
    expect(() => cpArgs(st('dhw_5km/CRW_SST/x.parquet'), 's3://b/gazetteer')).toThrow(/the engine's/)
    expect(() => cpArgs(st('items/dhw_5km_CRW_BAA_NMS-CINMS.json'), 's3://b/gazetteer')).toThrow(/the engine's/)
    expect(cpArgs(st('cmems_salinity/so/x.parquet'), 's3://b/gazetteer')[3]).toBe('s3://b/gazetteer/stats/cmems_salinity/so/x.parquet')
    expect(isOurs('stats/dhw_5km/CRW_BAA/x.parquet')).toBe(false)
    expect(isOurs('stats/dhw_5km/CRW_BAA')).toBe(false)
    expect(isOurs('stats/items/dhw_5km_CRW_SST_NMS-CINMS.json')).toBe(false)
    expect(isOurs('stats/IMERG_monthly_global_precip/precipitation/NMS:CINMS.parquet')).toBe(false)
    expect(isOurs('stats/items/IMERG_monthly_global_precip_precipitation_NMS-CINMS.json')).toBe(false)
    expect(isOurs('stats/dhw_5km_other/x.parquet')).toBe(true)
    expect(isOurs('stats/items/x.json')).toBe(true)
    expect(isOurs('stats/collection.json')).toBe(true)        // built here (stac.ts) until the last series moves
    expect(isOurs('stats/cmems_salinity/so/x.parquet')).toBe(true)
    expect(isOurs('places/places.parquet')).toBe(true)
  })
  it('stats.yml writes nothing of an engine series: its stats sync excludes syncExcludes() and never deletes', () => {
    const wf = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'stats.yml'), 'utf8')
    // every aws s3 command, its continuation lines joined; comments dropped
    const cmds = wf.replace(/\\\n\s*/g, ' ').split('\n').map((l) => l.replace(/^\s*#.*$/, '').trim())
      .filter((l) => /\baws s3 /.test(l))
    expect(cmds.length).toBeGreaterThan(0)
    let statsSyncs = 0
    for (const c of cmds) {
      // the positional arguments after `aws s3 <verb>`: options and their values dropped
      const rest = c.split(/\baws s3 /)[1].replace(/--(exclude|include|content-type) \S+/g, '')
        .split(/\s+/).filter((a) => a && !a.startsWith('-') && a !== '$SYNC_DRY_RUN' && a !== '"${excl[@]}"')
      const [verb, , dest] = rest
      expect(['sync', 'cp'], c).toContain(verb)              // never rm or mv
      const to = (dest ?? '').replace(/^["']|["']$/g, '')
      if (to.startsWith('s3://')) expect(to, c).not.toMatch(/\/gazetteer\/stats\/(dhw_5km|items\/dhw_5km_)/)
      // a sync of the whole gazetteer/stats/ prefix must exclude every engine series (the patterns from ci.ts) and
      // never delete
      if (/\/gazetteer\/stats\/?$/.test(to)) {
        statsSyncs++
        expect(c, c).toContain('"${excl[@]}"')
        expect(c, c).not.toContain('--delete')
      }
    }
    expect(statsSyncs).toBe(1)
    expect(wf).toContain("done < <(cd precompute && npx tsx src/ci.ts sync-excludes)")
    expect(wf).toContain('excl+=(--exclude "$p")')
    // the per-collection loop skips stats/, so its --delete never reaches gazetteer/stats/
    expect(wf).toMatch(/case "\$name" in stats\|rasters\|climatology\|series\) continue ;; esac/)
    expect(wf).toContain('2026-10-24')
  })
  it('does nothing without a prefix', async () => {
    const p = publisher('', async () => { throw new Error('should not run') }, () => {})
    await p.publish([join(GAZETTEER, 'stats', 'x.parquet')])
    expect(p.enabled).toBe(false)
  })
})
