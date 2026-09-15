// @vitest-environment jsdom
//
// The regression that broke the deployed build: MapView drove the camera two ways at once — a
// constant `center`/`zoom` pair passed to svelte-maplibre's <MapLibre>, and its own imperative
// `map.fitBounds()` in an $effect. svelte-maplibre's camera effect *reads* `center`/`zoom` and eases
// the map when they differ from `map.getCenter()`, while its `moveend` handler *writes* them back:
// with a fresh `[-158, 21]` array arriving on every render (never deep-equal to a LngLat) the two
// chased each other until Svelte gave up with `effect_update_depth_exceeded`, leaving the status at
// "reading the dataset time extent…" and an empty map.
//
// The fake map below fires `move`/`moveend` synchronously, which is what makes such a loop blow the
// effect depth inside one flush, so this test fails loudly if the two mechanisms are ever both wired
// up again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl', async () => await import('./__fixtures__/fakeMaplibre'))
vi.mock('pmtiles', () => ({ Protocol: class { tile = () => Promise.resolve({ data: null }) } }))

const PMTILES = 'https://example.invalid/gazetteer/places/places.pmtiles'

describe('MapView settles instead of looping', () => {
  let errors: unknown[] = []
  let onError: (e: ErrorEvent) => void

  beforeEach(() => {
    errors = []
    onError = (e: ErrorEvent) => errors.push(e.error ?? e.message)
    window.addEventListener('error', onError)
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a[0]) })
  })
  afterEach(() => { window.removeEventListener('error', onError); vi.restoreAllMocks() })

  async function mountMap(props: Record<string, unknown>) {
    const { mount, unmount, flushSync } = await import('svelte')
    const MapView = (await import('./MapView.svelte')).default
    const target = document.createElement('div')
    document.body.appendChild(target)
    let thrown: unknown = null
    let app: any = null
    try {
      app = mount(MapView, { target, props: { pmtilesUrl: PMTILES, placeId: 'NMS:HIHWNMS', ...props } })
      flushSync()
    } catch (e) { thrown = e }
    await new Promise((r) => setTimeout(r, 50))
    const messages = [thrown, ...errors].filter(Boolean).map((e: any) => String(e?.message ?? e)).join('\n')
    return { thrown, messages, target, close: async () => { if (app) await unmount(app) } }
  }

  it('fits a place without an effect loop', async () => {
    const m = await mountMap({ bounds: [-158.3, 20.4, -155.8, 21.9] })
    expect(m.messages).not.toMatch(/effect_update_depth_exceeded/)
    expect(m.thrown).toBeNull()
    await m.close()
  })

  it('survives a bounds change (picking another place) and an antimeridian fit', async () => {
    const props = $state({ bounds: [-158.3, 20.4, -155.8, 21.9] as any })
    const m = await mountMap(props)
    expect(m.thrown).toBeNull()
    props.bounds = [177.8, 19.2, 210.0, 31.8]      // PMNM, east of 180
    const { flushSync } = await import('svelte')
    flushSync()
    await new Promise((r) => setTimeout(r, 50))
    expect(errors.map((e: any) => String(e?.message ?? e)).join('\n'))
      .not.toMatch(/effect_update_depth_exceeded/)
    await m.close()
  })

  it('draws grid squares and tabledap points without looping', async () => {
    const squares = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 0, properties: { lon: -158, lat: 21, weight: 1, value: 26.1 },
        geometry: { type: 'Polygon', coordinates: [[[-158.025, 20.975], [-157.975, 20.975], [-157.975, 21.025], [-158.025, 21.025], [-158.025, 20.975]]] } }],
    }
    const points = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 0, properties: { lon: -120.5, lat: 34, weight: 4, value: 15.1 },
        geometry: { type: 'Point', coordinates: [-120.5, 34] } }],
    }
    const a = await mountMap({ bounds: [-158.3, 20.4, -155.8, 21.9], squares })
    expect(a.messages).not.toMatch(/effect_update_depth_exceeded/)
    await a.close()
    const b = await mountMap({ bounds: [-121, 33.5, -119, 34.5], points })
    expect(b.messages).not.toMatch(/effect_update_depth_exceeded/)
    await b.close()
  })
})

describe('the basemap', () => {
  it('asks Esri World Ocean Base for {z}/{y}/{x}, in that order, with attribution', async () => {
    const { OCEAN_TILES, OCEAN_ATTRIBUTION } = await import('./MapView.svelte')
    expect(OCEAN_TILES).toBe(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}')
    expect(OCEAN_ATTRIBUTION).toMatch(/Esri/)
  })
})
