<script lang="ts">
  // Then | Now swipe map: two plain MapLibre maps in one box (no svelte-maplibre here: the two
  // cameras are synced by hand, see swipe.ts), the Esri keyless basemap, the place outline from
  // places.pmtiles, and each side's raster band as a MapLibre `image` source drawn from a canvas
  // (nearest-neighbour, so the 0.05° pixels stay square). in anomaly mode the left map shows the
  // Now - Then layer over the whole box and the slider is hidden.
  import { onMount } from 'svelte'
  import maplibregl, { type Map as MlMap, type StyleSpecification } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { Protocol } from 'pmtiles'
  import { OCEAN_ATTRIBUTION, OCEAN_TILES } from '../MapView.svelte'
  import { PLACES_SOURCE_LAYER } from '../gazetteer'
  import { clipFor, syncMaps } from './swipe'

  export interface Img { url: string; bbox: [number, number, number, number] }
  interface Props {
    pmtilesUrl: string
    placeId   : string
    bounds    : [number, number, number, number] | null
    left      : Img | null          // Then (or the anomaly when `single`)
    right     : Img | null          // Now
    single    : boolean
    swipe     : number              // 0..1
    onswipe  ?: (f: number) => void
    onhover  ?: (ll: { lng: number; lat: number } | null) => void
  }
  let { pmtilesUrl, placeId, bounds, left, right, single, swipe, onswipe, onhover }: Props = $props()

  if (!(globalThis as any).__pmtilesProtocol) {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)
    ;(globalThis as any).__pmtilesProtocol = protocol
  }

  let box   = $state<HTMLDivElement | null>(null)
  let elA   = $state<HTMLDivElement | null>(null)
  let elB   = $state<HTMLDivElement | null>(null)
  let width = $state(0)
  let pos   = $state(0.5)               // the live slider fraction (dragging does not touch the hash)
  let ready = $state(false)
  let mapA: MlMap | null = null, mapB: MlMap | null = null

  $effect(() => { pos = swipe })

  function style(): StyleSpecification {
    return {
      version: 8,
      sources: {
        ocean : { type: 'raster', tiles: [OCEAN_TILES], tileSize: 256, maxzoom: 13, attribution: OCEAN_ATTRIBUTION },
        places: { type: 'vector', url: `pmtiles://${pmtilesUrl}`, minzoom: 0, maxzoom: 12 },
      },
      layers: [
        { id: 'ocean', type: 'raster', source: 'ocean' },
        { id: 'outline', type: 'line', source: 'places', 'source-layer': PLACES_SOURCE_LAYER,
          filter: ['==', ['get', 'place_id'], placeId],
          paint: { 'line-color': '#111', 'line-width': 1.6 } },
      ],
    }
  }

  onMount(() => {
    const opts = { style: style(), center: [-80.5, 25] as [number, number], zoom: 6, dragRotate: false, pitchWithRotate: false }
    mapA = new maplibregl.Map({ container: elA!, ...opts, attributionControl: false })
    mapB = new maplibregl.Map({ container: elB!, ...opts, attributionControl: { compact: true } })
    mapB.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const unsync = syncMaps(mapA, mapB)
    let n = 0
    const loaded = () => { if (++n === 2) { ready = true; fit() } }
    mapA.on('load', loaded); mapB.on('load', loaded)
    for (const m of [mapA, mapB]) {
      m.on('mousemove', (e) => onhover?.(e.lngLat))
      m.on('mouseout', () => onhover?.(null))
    }
    const ro = new ResizeObserver(() => { width = box?.clientWidth ?? 0; mapA?.resize(); mapB?.resize() })
    ro.observe(box!)
    return () => { ro.disconnect(); unsync(); mapA?.remove(); mapB?.remove(); mapA = mapB = null }
  })

  function fit() {
    const b = bounds
    if (!ready || !mapA || !b || !(b[2] > b[0] && b[3] > b[1])) return
    mapA.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, maxZoom: 10, animate: false })
  }
  // re-fit when the place (its bounds) changes; the key keeps a same-valued array from refitting
  let fitKey = ''
  $effect(() => {
    const k = JSON.stringify(bounds)
    if (ready && k !== fitKey) { fitKey = k; fit() }
  })
  $effect(() => {
    const id = placeId
    if (!ready) return
    for (const m of [mapA, mapB]) m?.setFilter('outline', ['==', ['get', 'place_id'], id])
  })

  function setImage(m: MlMap | null, img: Img | null) {
    if (!m) return
    const src = m.getSource('band') as maplibregl.ImageSource | undefined
    if (!img) { if (src) { m.removeLayer('band'); m.removeSource('band') } return }
    const [w, s, e, n] = img.bbox
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[w, n], [e, n], [e, s], [w, s]]
    if (src) src.updateImage({ url: img.url, coordinates })
    else {
      m.addSource('band', { type: 'image', url: img.url, coordinates })
      m.addLayer({ id: 'band', type: 'raster', source: 'band',
                   paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, 'outline')
    }
  }
  $effect(() => { const l = left;  if (ready) setImage(mapA, l) })
  $effect(() => { const r = single ? null : right; if (ready) setImage(mapB, r) })

  // ── the slider ──────────────────────────────────────────────────────────────
  let dragging = false
  function down(e: PointerEvent) {
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  function move(e: PointerEvent) {
    if (!dragging || !box) return
    const r = box.getBoundingClientRect()
    pos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  function up() { if (!dragging) return; dragging = false; onswipe?.(pos) }
  function key(e: KeyboardEvent) {
    const d = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0
    if (!d) return
    e.preventDefault(); pos = Math.min(1, Math.max(0, pos + d)); onswipe?.(pos)
  }
</script>

<div class="box" bind:this={box}>
  <div class="m" bind:this={elA}></div>
  <div class="m" bind:this={elB} style:clip-path={single ? 'inset(0 0 0 100%)' : clipFor(pos, width)}
       style:pointer-events={single ? 'none' : null}></div>
  {#if !single}
    <div class="slider" style:left="{pos * 100}%" role="slider" tabindex="0" aria-label="swipe between Then and Now"
         aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
         onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
      <span>‹ ›</span>
    </div>
  {/if}
</div>

<style>
  .box    { position: relative; height: 460px; width: 100%; border: 1px solid #ddd; border-radius: 3px; overflow: hidden; }
  .m      { position: absolute; inset: 0; }
  .slider { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,.6);
            z-index: 5; cursor: ew-resize; touch-action: none; }
  .slider span { position: absolute; top: 50%; left: -17px; width: 32px; height: 32px; margin-top: -16px; border-radius: 50%;
                 background: #fff; box-shadow: 0 0 4px rgba(0,0,0,.5); font: 600 13px/32px system-ui; text-align: center; color: #333; user-select: none; }
  @media (max-width: 640px) { .box { height: 340px; } }
</style>
