// @vitest-environment jsdom
//
// A regression for `effect_update_depth_exceeded`: the app used to lock up on load with an $effect
// that wrote state it also read, which left the status stuck at "reading the dataset time extent…"
// and the map empty. Mount the real App (with a permalink in the hash, which is what made the loop
// reachable), let the effects settle, and assert nothing was thrown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const INFO = JSON.parse(readFileSync(path.join(DIR, 'lib/__fixtures__/info_noaa_aoml_seascapes_8day.json'), 'utf8'))
const PLACE = JSON.parse(readFileSync(path.join(DIR, 'lib/__fixtures__/HIHWNMS.geojson'), 'utf8'))

const place = {
  place_id : 'NMS:HIHWNMS',
  gazetteer: 'NMS',
  name     : 'Hawaiian Islands Humpback Whale',
  area_km2 : 3548,
  bbox     : [-158.3, 20.4, -155.8, 21.9] as [number, number, number, number],
  geometry : (PLACE.features?.[0]?.geometry ?? PLACE.geometry ?? PLACE) as any,
}
const dataset = {
  id: 'erddap/dhw_5km', title: 'CRW 5km', baseUrl: 'https://example.invalid/erddap',
  datasetId: 'dhw_5km', protocol: 'griddap' as const, cors: true, formats: ['parquet'],
  lonRange: [-180, 180] as [number, number], latDescending: true, format: 'parquet' as const,
  variables: [{ name: 'CRW_SST', unit: 'Celsius', description: 'sst', categorical: false }],
  collection: {},
}

// the network, DuckDB and the WebGL map are all out of scope here: this test is about the effects
vi.mock('./lib/gazetteer', async (orig) => ({
  ...(await orig<any>()),
  loadPlaces      : vi.fn(async () => [place]),
  gazetteerBase   : () => 'https://example.invalid/gazetteer/',
  placesPmtilesUrl: () => 'https://example.invalid/gazetteer/places/places.pmtiles',
}))
vi.mock('./lib/catalog', async (orig) => ({
  ...(await orig<any>()),
  loadDatasets: vi.fn(async () => [dataset]),
}))
vi.mock('./lib/engine', () => ({
  engine: {
    ready: Promise.resolve(), lastSql: '', marks: [],
    registerBuffer: vi.fn(async () => {}), insertRows: vi.fn(async () => {}),
    insertMask: vi.fn(async () => {}), exec: vi.fn(async () => []),
    runTemplate: vi.fn(async () => []), toParquet: vi.fn(async () => new Uint8Array()),
  },
}))
// the real MapView mounts here, over a fake maplibre-gl (jsdom has no WebGL): its camera moves fire
// move/moveend synchronously, so an effect that read and wrote the same state would blow up here
vi.mock('maplibre-gl', async () => await import('./lib/__fixtures__/fakeMaplibre'))
vi.mock('pmtiles', () => ({ Protocol: class { tile = () => Promise.resolve({ data: null }) } }))

describe('App mounts without an effect loop', () => {
  let errors: unknown[] = []
  let onError: (e: ErrorEvent) => void

  beforeEach(() => {
    errors = []
    onError = (e: ErrorEvent) => errors.push(e.error ?? e.message)
    window.addEventListener('error', onError)
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a[0]) })
    vi.stubGlobal('fetch', vi.fn(async (url: any) => new Response(JSON.stringify(INFO), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    location.hash = '#place=NMS:HIHWNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=2026-05-28&to=2026-06-26'
  })
  afterEach(() => { window.removeEventListener('error', onError); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('settles: no effect_update_depth_exceeded within 500 ms', async () => {
    const { mount, unmount } = await import('svelte')
    const App = (await import('./App.svelte')).default
    const target = document.createElement('div')
    document.body.appendChild(target)

    let thrown: unknown = null
    let app: any
    try { app = mount(App, { target }) } catch (e) { thrown = e }
    const deadline = Date.now() + 500
    while (Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))

    const all = [thrown, ...errors].filter(Boolean).map((e: any) => String(e?.message ?? e)).join('\n')
    expect(all).not.toMatch(/effect_update_depth_exceeded/)
    expect(thrown).toBeNull()
    // and it got past the extent step rather than sticking there
    expect(target.textContent).toContain('erddap-places')
    expect(target.textContent).not.toContain('reading the dataset time extent')
    if (app) await unmount(app)
  })
})
