// the then-now reads against the published FKNMS cube on S3: a regression for the cost of a view
// (the header is ~147 kB on disk but geotiff only reads the tags it needs) and for the values.
// skipped offline (ERDDAP_OFFLINE=1, or S3 unreachable), like the other live tests.
import { beforeAll, describe, expect, it } from 'vitest'
import { CogReader } from './cog'
import { climUrl, rasterUrl } from './data'

const ROOT = 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/'
let online = false
beforeAll(async () => {
  if (process.env.ERDDAP_OFFLINE) return
  online = await fetch(`${ROOT}catalog.json`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.ok).catch(() => false)
}, 20_000)

describe('then-now on S3 (live)', () => {
  it('reads one FKNMS band in a few small range requests, then 8 kB per further day', async (ctx) => {
    if (!online) return ctx.skip()
    const r = new CogReader()
    const url = rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', 'NMS:FKNMS', 2024)
    const b = await r.read(url, 218)                                     // 05 Aug
    expect([b.width, b.height]).toEqual([78, 43])
    expect(r.meter.requests).toBeLessThanOrEqual(4)
    expect(r.meter.bytes).toBeLessThan(64 * 1024)
    const vals = Array.from(b.data).filter((v) => !Number.isNaN(v))
    expect(vals.length).toBeGreaterThan(1000)
    expect(Math.min(...vals)).toBeGreaterThan(25); expect(Math.max(...vals)).toBeLessThan(35)   // August SST, °C
    const before = r.meter.bytes
    await r.read(url, 219)
    expect(r.meter.bytes - before).toBeLessThanOrEqual(16 * 1024)
    const c = await r.read(climUrl(ROOT, 'dhw_5km', 'CRW_SST', 'NMS:FKNMS', '1985-2005'), 218)
    expect([c.width, c.height]).toEqual([78, 43])
  }, 60_000)
})
