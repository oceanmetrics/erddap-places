// a source host that does not answer is a warning, not a failed run (outage.ts, run.ts, ci.ts), offline:
// fetch is stubbed per host, the scheduler runs on a fake clock, files go to a temp dir.
import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { download, liveExtent, loadDataset } from './stats'
import { HostOutage, networkKind, outageMarkdown, outageOf } from './outage'
import { runUnits, type RunUnit } from './run'
import { unlistedItems } from './stac'
import { ErddapUnreachable } from '../../app/src/lib/fetchRetry'

const TMP = mkdtempSync(join(tmpdir(), 'outage-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const PACIOOS = 'pae-paha.pacioos.hawaii.edu', MIRROR = 'erddap.oceanmetrics.io', COASTWATCH = 'coastwatch.pfeg.noaa.gov'
const DAY0 = Date.parse('2026-10-23T09:17:00Z')

/** the connect timeout PacIOOS gave on 2026-10-22: undici's TypeError('fetch failed') caused by a coded error */
const connectTimeout = () => Object.assign(new TypeError('fetch failed'),
  { cause: Object.assign(new Error('Connect Timeout Error (attempted address: pae-paha.pacioos.hawaii.edu:443, timeout: 30000ms)'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })

const info = { table: { columnNames: ['Row Type', 'Variable Name', 'Attribute Name', 'Data Type', 'Value'], rows: [
  ['attribute', 'time', 'actual_range', 'double', '1.0E9, 1.1E9'],
  ['dimension', 'time', '', 'double', 'nValues=10, evenlySpaced=true, averageSpacing=1 day'],
] } }

/** fetch that answers per host: a Response, or a function that throws */
function fetchStub(byHost: Record<string, () => Response | never>) {
  return vi.fn(async (url: string | URL | Request) => byHost[new URL(String(url)).host]())
}
const answer  = () => new Response(JSON.stringify(info), { status: 200 })
const http    = (status: number, text: string) => () => new Response('<html>down</html>', { status, statusText: text })
const refuse  = (e: () => Error) => () => { throw e() }

// a fake clock: wait() advances it, so rests take no real time
function clock() {
  let t = 0
  return { now: () => DAY0 + t, wait: async (ms: number) => { await new Promise((r) => setTimeout(r, 0)); t += ms } }
}

interface U extends RunUnit { baseUrl: string }
const unit = (host: string, dataset: string, place: string): U =>
  ({ key: `${dataset}/CRW_SST/${place}`, host, dataset, variable: 'CRW_SST', place_id: place, baseUrl: `https://${host}/erddap` })

/** the unit's compute, the way precompute.ts does it: the extent probe (the real liveExtent), then the file, whole, once. */
function computer(dir: string, fetchFn: ReturnType<typeof fetchStub>, published: string[]) {
  return async (u: U) => {
    const ds = { ...loadDataset('dhw_5km'), baseUrl: u.baseUrl }
    await liveExtent(ds, { fetchFn: fetchFn as unknown as typeof fetch, wait: async () => {}, log: () => {}, attempts: 2 })
    const f = join(dir, `${u.place_id.replace(':', '_')}.parquet`)
    writeFileSync(f + '.tmp', 'new'); writeFileSync(f, 'new')
    published.push(f)
    return 'done' as const
  }
}
const setup = (name: string) => { const dir = join(TMP, name); mkdirSync(dir, { recursive: true }); return { dir, outageFile: join(dir, 'outage.json') } }
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'))

describe('outageOf: a host that did not answer, told from an error', () => {
  it('a connect timeout, a timeout abort and a 5xx are outages', () => {
    expect(networkKind(connectTimeout())).toBe('timeout')
    expect(networkKind(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('timeout')
    expect(networkKind(new TypeError('fetch failed'))).toBe('network')
    expect(networkKind(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('network')
    expect(outageOf(new HostOutage(PACIOOS, '5xx', '503', 503), 'other')!.host).toBe(PACIOOS)
  })
  it("the app's ErddapUnreachable (fetchAxis after its retries) is an outage of the host it names", () => {
    const o5 = outageOf(new ErddapUnreachable(PACIOOS, 'HTTP 503 Service Unavailable', 3, 'u'), 'x')!
    expect([o5.host, o5.kind, o5.status]).toEqual([PACIOOS, '5xx', 503])
    expect(outageOf(new ErddapUnreachable(PACIOOS, 'no response within 120 s', 3, 'u'), 'x')!.kind).toBe('timeout')
    expect(outageOf(new ErddapUnreachable(MIRROR, 'network error: fetch failed', 3, 'u'), 'x')!.kind).toBe('network')
  })
  it('a 4xx, a SQL error, a bug and a missing place are errors, not outages', () => {
    for (const e of [new Error('404 Not Found: Your query produced no matching results'),
                     new Error('IO Error: No files found that match the pattern'),
                     new TypeError("Cannot read properties of undefined (reading 'lobes')"),
                     new Error('no place MRGID:8439 in places.parquet')])
      expect(outageOf(e, PACIOOS)).toBeNull()
  })
})

describe('liveExtent and download: an outage after the retries, an error at once', () => {
  const ds = { ...loadDataset('dhw_5km'), baseUrl: `https://${PACIOOS}/erddap` }
  const base = { wait: async () => {}, log: () => {}, attempts: 2 }
  it('liveExtent: two connect timeouts throw a HostOutage naming the host', async () => {
    const f = vi.fn().mockRejectedValue(connectTimeout())
    const e = await liveExtent(ds, { ...base, fetchFn: f as any }).catch((x) => x)
    expect(e).toBeInstanceOf(HostOutage)
    expect([e.host, e.kind]).toEqual([PACIOOS, 'timeout'])
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('liveExtent: 5xx twice throws a HostOutage with the status; a 404 is a plain Error after one try', async () => {
    const f5 = vi.fn().mockImplementation(async () => new Response('', { status: 502, statusText: 'Bad Gateway' }))
    const e5 = await liveExtent(ds, { ...base, fetchFn: f5 as any }).catch((x) => x)
    expect([e5.kind, e5.status]).toEqual(['5xx', 502])
    const f4 = vi.fn().mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }))
    const e4 = await liveExtent(ds, { ...base, fetchFn: f4 as any }).catch((x) => x)
    expect(e4).not.toBeInstanceOf(HostOutage)
    expect(f4).toHaveBeenCalledTimes(1)
  })
  const url = `https://${PACIOOS}/erddap/griddap/dhw_5km.parquet?CRW_SST%5B(2026-10-01T12:00:00Z):1:(2026-10-01T12:00:00Z)%5D`
  it('download: 503 twice is an outage and leaves no file; a 400 is an error; a connect timeout is an outage', async () => {
    const dir = join(TMP, 'dl'), opts = (f: any) => ({ fetchFn: f, wait: async () => {} })
    const f503 = vi.fn().mockImplementation(async () => new Response('Error { code=503 }', { status: 503, statusText: '' }))
    const e1 = await download(url, join(dir, 'a.parquet'), () => {}, opts(f503)).catch((x) => x)
    expect(e1).toBeInstanceOf(HostOutage); expect(e1.status).toBe(503); expect(e1.message).toMatch(/griddap failed twice/)
    expect(existsSync(join(dir, 'a.parquet'))).toBe(false)
    const f400 = vi.fn().mockImplementation(async () => new Response('bad constraint', { status: 400, statusText: 'Bad Request' }))
    const e2 = await download(url, join(dir, 'b.parquet'), () => {}, opts(f400)).catch((x) => x)
    expect(e2).toBeInstanceOf(Error); expect(e2).not.toBeInstanceOf(HostOutage)
    const ft = vi.fn().mockRejectedValue(connectTimeout())
    const e3 = await download(url, join(dir, 'c.parquet'), () => {}, opts(ft)).catch((x) => x)
    expect([e3.host, e3.kind]).toEqual([PACIOOS, 'timeout'])
  })
})

describe('runUnits: a host outage skips its units, publishes the rest, and exits 0', () => {
  const run = (name: string, units: U[], stub: Record<string, () => Response | never>, compute?: (u: U) => Promise<'done'>) => {
    const { dir, outageFile } = setup(name), c = clock(), published: string[] = []
    const fetchFn = fetchStub(stub)
    return runUnits(units, {
      compute: compute ?? computer(dir, fetchFn, published), outageFile, log: () => {},
      now: c.now, wait: c.wait, restMs: [600_000], maxAttempts: 2, deadline: DAY0 + 21 * 3_600_000,
    }).then((report) => ({ report, published, outageFile, dir }))
  }

  it('one host times out, the other answers: one unit published, one skipped, exit 0, outage.json says which', async () => {
    const old = setup('t1'); writeFileSync(join(old.dir, 'NMS_PMNM.parquet'), 'old')       // the skipped unit's earlier file
    const { report, published, outageFile } = await run('t1', [unit(PACIOOS, 'dhw_5km', 'NMS:PMNM'), unit(MIRROR, 'cmems_salinity', 'NMS:FKNMS')],
      { [PACIOOS]: refuse(connectTimeout), [MIRROR]: answer })
    expect(report.exitCode).toBe(0)
    expect(published.map((f) => f.split('/').pop())).toEqual(['NMS_FKNMS.parquet'])
    expect(readFileSync(join(old.dir, 'NMS_PMNM.parquet'), 'utf8')).toBe('old')           // untouched, not partial
    expect(report.units.map((u) => [u.key, u.status, u.answered])).toEqual([
      ['dhw_5km/CRW_SST/NMS:PMNM', 'skipped', false], ['cmems_salinity/CRW_SST/NMS:FKNMS', 'completed', true]])
    const o = read(outageFile)
    expect(o.units).toEqual({ total: 2, completed: 1, skipped: 1, errors: 0, deferred: 0 })
    expect(o.hosts).toHaveLength(1)
    expect(o.hosts[0]).toMatchObject({ host: PACIOOS, kinds: ['timeout'], first_failure: '2026-10-23T09:17:00Z', last_failure: '2026-10-23T09:27:00Z' })
    expect(o.hosts[0].units_skipped).toEqual([{
      key: 'dhw_5km/CRW_SST/NMS:PMNM', dataset: 'dhw_5km', variable: 'CRW_SST', place: 'NMS:PMNM', kind: 'timeout',
      reason: expect.stringMatching(/extent probe failed 2 times/), tries: 2,
      first_failure: '2026-10-23T09:17:00Z', last_failure: '2026-10-23T09:27:00Z' }])
  })

  it('a 5xx host is an outage too: every host down skips every unit, publishes nothing, still exits 0', async () => {
    const { report, published, outageFile } = await run('t2', [unit(PACIOOS, 'dhw_5km', 'NMS:CBNMS'), unit(COASTWATCH, 'noaa_x', 'NMS:CBNMS')],
      { [PACIOOS]: http(503, 'Service Unavailable'), [COASTWATCH]: http(500, 'Internal Server Error') })
    expect(report.exitCode).toBe(0)
    expect(published).toEqual([])
    const o = read(outageFile)
    expect(o.hosts.map((h: any) => [h.host, h.kinds, h.units_skipped[0].status])).toEqual([[COASTWATCH, ['5xx'], 500], [PACIOOS, ['5xx'], 503]])
    expect(o.units).toMatchObject({ completed: 0, skipped: 2, errors: 0 })
  })

  it('a unit that recovers on a later try is completed, and a run where every host recovered writes no outage file', async () => {
    let n = 0
    const flaky = () => { if (n++ < 2) throw connectTimeout(); return answer() }   // the extent probe's two attempts fail, then it answers
    const { report, outageFile } = await run('t3', [unit(PACIOOS, 'dhw_5km', 'NMS:CBNMS')], { [PACIOOS]: flaky })
    expect(report.units[0].status).toBe('completed')
    expect(report.exitCode).toBe(0)
    expect(existsSync(outageFile)).toBe(false)
  })

  it('a data error still fails the run (exit 1), with an outage elsewhere still reported', async () => {
    const { report, outageFile } = await run('t4', [unit(PACIOOS, 'dhw_5km', 'NMS:CBNMS'), unit(MIRROR, 'cmems_salinity', 'NMS:FKNMS')],
      { [PACIOOS]: refuse(connectTimeout), [MIRROR]: http(404, 'Not Found') })
    expect(report.exitCode).toBe(1)
    expect(report.units.find((u) => u.place === 'NMS:FKNMS')).toMatchObject({ status: 'error', answered: true })
    expect(read(outageFile).units).toMatchObject({ skipped: 1, errors: 1 })
  })

  it('a code error fails the run: a throw that is not a network failure', async () => {
    const { report } = await run('t5', [unit(MIRROR, 'cmems_salinity', 'NMS:FKNMS')], {}, async () => { throw new Error('Binder Error: column "mean" not found') })
    expect(report.exitCode).toBe(1)
    expect(report.units[0]).toMatchObject({ status: 'error', reason: expect.stringMatching(/Binder Error/) })
  })

  it('a complete run writes no outage file, and removes a stale one from an earlier run', async () => {
    const { dir, outageFile } = setup('t6')
    writeFileSync(outageFile, '{"stale":true}')
    const published: string[] = []
    const stub = fetchStub({ [PACIOOS]: answer, [MIRROR]: answer }), c = clock()
    const report = await runUnits([unit(PACIOOS, 'dhw_5km', 'NMS:CBNMS'), unit(MIRROR, 'cmems_salinity', 'NMS:FKNMS')], {
      compute: computer(dir, stub, published), outageFile, log: () => {}, now: c.now, wait: c.wait })
    expect(report.exitCode).toBe(0)
    expect(report.outage).toBeNull()
    expect(published).toHaveLength(2)
    expect(existsSync(outageFile)).toBe(false)
  })

  it('regression 2026-10-22: PacIOOS connect timeouts for the whole deadline skip its units and the run stays green', async () => {
    // a lane of units that never gets an answer: some are tried and fail, the rest are still queued at the deadline
    const units = Array.from({ length: 12 }, (_, i) => unit(PACIOOS, 'dhw_5km', `NMS:P${i}`))
    const { dir, outageFile } = setup('t7'), c = clock(), published: string[] = []
    const report = await runUnits(units, {
      compute: computer(dir, fetchStub({ [PACIOOS]: refuse(connectTimeout) }), published), outageFile, log: () => {},
      now: c.now, wait: c.wait, restMs: [600_000, 1_800_000, 3_600_000, 7_200_000], maxAttempts: 3, deadline: DAY0 + 6 * 3_600_000 })
    expect(report.exitCode).toBe(0)
    expect(report.units.every((u) => u.status === 'skipped')).toBe(true)     // none reported as plain "deferred" or "error"
    const o = read(outageFile)
    expect(o.hosts[0].units_skipped).toHaveLength(12)
    expect(o.units.deferred).toBe(0)
  })
})

describe('outageMarkdown: the step summary', () => {
  it('names each host, the counts and the skipped units', async () => {
    const { dir, outageFile } = setup('md'), c = clock()
    const r = await runUnits([unit(PACIOOS, 'dhw_5km', 'NMS:PMNM'), unit(MIRROR, 'cmems_salinity', 'NMS:FKNMS')], {
      compute: computer(dir, fetchStub({ [PACIOOS]: http(503, 'Service Unavailable'), [MIRROR]: answer }), []), outageFile, log: () => {},
      now: c.now, wait: c.wait, restMs: [600_000], maxAttempts: 2 })
    const md = outageMarkdown(r.outage!)
    expect(md).toContain('1 of 2 unit(s) were skipped')
    expect(md).toContain(`| \`${PACIOOS}\` | 5xx | 1 | 2026-10-23T09:17:00Z | 2026-10-23T09:27:00Z |`)
    expect(md).toContain('`dhw_5km/CRW_SST/NMS:PMNM`')
  })
})

describe('unlistedItems: the Items collection.json does not link', () => {
  it("regression 2026-10-20: a requested or removed place's fetched Item has no link and failed rashid PTL-LNK-002", () => {
    const dir = join(TMP, 'stats'); mkdirSync(join(dir, 'items'), { recursive: true })
    const item = (id: string) => writeFileSync(join(dir, 'items', `${id}.json`), '{}')
    ;['dhw_5km_CRW_SST_NMS-PMNM', 'dhw_5km_CRW_SST_PSGID-939', 'IMERG_monthly_global_precip_precipitation_NERRS-WEL'].forEach(item)
    writeFileSync(join(dir, 'collection.json'), JSON.stringify({ links: [
      { rel: 'root', href: '../catalog.json' }, { rel: 'item', href: './items/dhw_5km_CRW_SST_NMS-PMNM.json' }] }))
    expect(unlistedItems(dir)).toEqual(['IMERG_monthly_global_precip_precipitation_NERRS-WEL.json', 'dhw_5km_CRW_SST_PSGID-939.json'])
  })
})
