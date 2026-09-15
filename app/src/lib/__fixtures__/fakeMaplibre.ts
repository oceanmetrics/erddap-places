// a fake `maplibre-gl` for jsdom: enough of the Map API for svelte-maplibre's components to mount,
// with the one behaviour that matters for the effect-loop regression — a camera move fires
// `move`/`moveend` **synchronously**, which is what lets a read-and-write $effect run away inside a
// single Svelte flush. Nothing here draws anything; there is no WebGL in jsdom.

type Handler = (e: any) => void

export class LngLat {
  constructor(public lng: number, public lat: number) {}
  static convert(v: any): LngLat {
    if (v instanceof LngLat) return v
    if (Array.isArray(v)) return new LngLat(v[0], v[1])
    return new LngLat(v.lng ?? v.lon ?? 0, v.lat ?? 0)
  }
  toArray() { return [this.lng, this.lat] }
  /** svelte-maplibre's boundsEqual() wraps before comparing, which is how east-of-180 bounds work. */
  wrap() { return new LngLat(((((this.lng + 180) % 360) + 360) % 360) - 180, this.lat) }
}

export class LngLatBounds {
  sw: LngLat; ne: LngLat
  constructor(sw?: any, ne?: any) {
    if (Array.isArray(sw) && Array.isArray(sw[0])) { this.sw = LngLat.convert(sw[0]); this.ne = LngLat.convert(sw[1]) }
    else if (Array.isArray(sw) && sw.length === 4)  { this.sw = new LngLat(sw[0], sw[1]); this.ne = new LngLat(sw[2], sw[3]) }
    else { this.sw = LngLat.convert(sw ?? [0, 0]); this.ne = LngLat.convert(ne ?? [0, 0]) }
  }
  static convert(v: any): LngLatBounds { return v instanceof LngLatBounds ? v : new LngLatBounds(v) }
  getSouthWest() { return this.sw }
  getNorthEast() { return this.ne }
  getWest()  { return this.sw.lng }
  getSouth() { return this.sw.lat }
  getEast()  { return this.ne.lng }
  getNorth() { return this.ne.lat }
  toArray() { return [this.sw.toArray(), this.ne.toArray()] }
}

const noop = () => {}
const toggle = () => ({ enable: noop, disable: noop, isEnabled: () => true })

export class Map {
  #on = new Map2()
  #center: LngLat
  #zoom: number
  #bounds: LngLatBounds
  #container: HTMLElement
  #canvas: HTMLCanvasElement
  /** camera moves applied, so a test can assert the map is not being eased in a loop */
  moves = 0
  style = { layers: [] as any[] }

  constructor(public options: any = {}) {
    this.#container = options.container ?? document.createElement('div')
    this.#canvas = document.createElement('canvas')
    this.#center = LngLat.convert(options.center ?? [0, 0])
    this.#zoom = options.zoom ?? 0
    this.#bounds = new LngLatBounds([this.#center.lng - 1, this.#center.lat - 1], [this.#center.lng + 1, this.#center.lat + 1])
    if (options.bounds) this.#apply(LngLatBounds.convert(options.bounds))
    queueMicrotask(() => this.#fire('load', {}))
  }

  // ── events ────────────────────────────────────────────────────────────────
  on(type: string, a: any, b?: any) { this.#on.add(type, typeof a === 'function' ? a : b); return this }
  once(type: string, a: any, b?: any) { return this.on(type, a, b) }
  off() { return this }
  #fire(type: string, e: any) { for (const h of this.#on.get(type)) h({ ...e, type, target: this }) }

  // ── camera: the moves land immediately and fire moveend synchronously ─────
  #apply(b: LngLatBounds) {
    this.#bounds = b
    this.#center = new LngLat((b.getWest() + b.getEast()) / 2, (b.getSouth() + b.getNorth()) / 2)
    // a real fitBounds lands on a zoom of its own (padding, maxZoom): never exactly what was asked
    this.#zoom = 8
  }
  #moved() {
    this.moves++
    this.#fire('movestart', {}); this.#fire('move', {}); this.#fire('moveend', {})
  }
  fitBounds(b: any, _opts?: any) { this.#apply(LngLatBounds.convert(b)); this.#moved(); return this }
  easeTo(o: any = {}) { return this.jumpTo(o) }
  flyTo(o: any = {}) { return this.jumpTo(o) }
  jumpTo(o: any = {}) {
    if (o.center != null) this.#center = LngLat.convert(o.center)
    if (o.zoom != null) this.#zoom = o.zoom
    this.#bounds = new LngLatBounds([this.#center.lng - 1, this.#center.lat - 1], [this.#center.lng + 1, this.#center.lat + 1])
    this.#moved()
    return this
  }
  getCenter() { return this.#center }
  getZoom() { return this.#zoom }
  getBounds() { return this.#bounds }
  getPitch() { return 0 }
  getBearing() { return 0 }
  setProjection() { return this }
  setMaxBounds() { return this }

  // ── the rest: inert stubs ─────────────────────────────────────────────────
  getContainer() { return this.#container }
  getCanvas() { return this.#canvas }
  getCanvasContainer() { return this.#container }
  loaded() { return true }
  isStyleLoaded() { return true }
  remove() { this.#on = new Map2() }
  resize() { return this }
  addControl() { return this }
  removeControl() { return this }
  hasControl() { return false }
  getStyle() { return this.style }
  setStyle() { return this }
  addSource() { return this }
  getSource() { return undefined }
  removeSource() { return this }
  isSourceLoaded() { return true }
  addLayer(l: any) { this.style.layers.push(l); return this }
  getLayer(id: string) { return this.style.layers.find((l) => l.id === id) }
  removeLayer(id: string) { this.style.layers = this.style.layers.filter((l) => l.id !== id); return this }
  moveLayer() { return this }
  setFilter() { return this }
  setPaintProperty() { return this }
  setLayoutProperty() { return this }
  setLayerZoomRange() { return this }
  setFeatureState() { return this }
  removeFeatureState() { return this }
  queryRenderedFeatures() { return [] }
  querySourceFeatures() { return [] }
  listImages() { return [] }
  hasImage() { return true }
  addImage() { return this }
  loadImage() { return Promise.resolve({ data: null }) }
  getLayersOrder() { return this.style.layers.map((l) => l.id) }
  project(ll: any) { const c = LngLat.convert(ll); return { x: c.lng, y: c.lat } }
  unproject(p: any) { return new LngLat(p.x ?? 0, p.y ?? 0) }
  doubleClickZoom = toggle()
  scrollZoom = toggle()
  dragPan = toggle()
  dragRotate = toggle()
  touchZoomRotate = toggle()
  touchPitch = toggle()
  keyboard = toggle()
  boxZoom = toggle()
}

/** a tiny multimap, kept private to the fake Map. */
class Map2 {
  #m = new globalThis.Map<string, Handler[]>()
  add(k: string, h: Handler) { if (h) this.#m.set(k, [...(this.#m.get(k) ?? []), h]) }
  get(k: string) { return this.#m.get(k) ?? [] }
}

class Control { onAdd() { return document.createElement('div') } onRemove() {} }
export class NavigationControl extends Control {}
export class GeolocateControl extends Control { on() {} off() {} }
export class FullscreenControl extends Control {}
export class ScaleControl extends Control { setUnit() {} }
export class AttributionControl extends Control {}
export class TerrainControl extends Control {}

export class Popup {
  #el = document.createElement('div')
  constructor(public options: any = {}) {}
  setLngLat() { return this }
  setDOMContent() { return this }
  setHTML() { return this }
  addTo() { return this }
  remove() { return this }
  isOpen() { return false }
  getElement() { return this.#el }
  on() { return this }
  off() { return this }
  addClassName() { return this }
  removeClassName() { return this }
  setOffset() { return this }
  setMaxWidth() { return this }
}
export class Marker {
  constructor(public options: any = {}) {}
  setLngLat() { return this }
  addTo() { return this }
  remove() { return this }
  getElement() { return document.createElement('div') }
  on() { return this }
  off() { return this }
  setDraggable() { return this }
  setOffset() { return this }
  setRotation() { return this }
  setPopup() { return this }
}

/** svelte-maplibre's sources look here before registering the pmtiles:// protocol themselves. */
export const config: { REGISTERED_PROTOCOLS: Record<string, unknown> } = { REGISTERED_PROTOCOLS: {} }

export const addProtocol = (name: string) => { config.REGISTERED_PROTOCOLS[name] = true }
export const removeProtocol = () => {}
export const setRTLTextPlugin = () => {}

export default {
  config, Map, LngLat, LngLatBounds, Popup, Marker, NavigationControl, GeolocateControl,
  FullscreenControl, ScaleControl, AttributionControl, TerrainControl,
  addProtocol, removeProtocol, setRTLTextPlugin,
}
