<script lang="ts">
  // Then | Now swipe map: two plain MapLibre maps in one box (no svelte-maplibre here: the two
  // cameras are synced by hand, see swipe.ts), the Esri keyless basemap, the place outline from
  // places.pmtiles, and each side's raster band as a MapLibre `image` source drawn from a canvas
  // (nearest-neighbour, so the 0.05° pixels stay square). in anomaly mode the left map shows the
  // Now - Then layer over the whole box and the slider is hidden.
  import { onMount, untrack } from 'svelte'
  import maplibregl, { type Map as MlMap, type StyleSpecification } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { Protocol } from 'pmtiles'
  import { basemapStyle, DARK_ATTRIBUTION, OCEAN_ATTRIBUTION, setBasemap } from '../MapView.svelte'
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
    /** the dark theme's basemap */
    dark     ?: boolean
    /** room to leave around the fitted place (the panes float over the map) */
    padding  ?: number | { top: number; bottom: number; left: number; right: number }
    /** the side captions, drawn at the top beside the swipe handle (left alone in anomaly mode) */
    leftLabel ?: string
    rightLabel?: string
    /** both maps once loaded (Then/anomaly on the left, Now on the right), for the PNG of the view */
    onmaps   ?: (a: MlMap, b: MlMap) => void
  }
  let { pmtilesUrl, placeId, bounds, left, right, single, swipe, onswipe, onhover, dark = false, onmaps, leftLabel = '', rightLabel = '', padding = 30 }: Props = $props()

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
    const base = basemapStyle(untrack(() => dark))
    return {
      version: 8,
      sources: {
        ...base.sources,
        places: { type: 'vector', url: `pmtiles://${pmtilesUrl}`, minzoom: 0, maxzoom: 12 },
      },
      layers: [
        ...base.layers,
        { id: 'outline', type: 'line', source: 'places', 'source-layer': PLACES_SOURCE_LAYER,
          filter: ['==', ['get', 'place_id'], placeId],
          paint: { 'line-color': untrack(() => dark) ? '#eaf3f7' : '#111', 'line-width': 2.5 } },
      ],
    }
  }

  onMount(() => {
    const opts = { style: style(), center: [-80.5, 25] as [number, number], zoom: 6, dragRotate: false, pitchWithRotate: false }
    mapA = new maplibregl.Map({ container: elA!, ...opts, attributionControl: false })
    // the basemap credit sits on the box (below), not on either map: one side is always clipped
    mapB = new maplibregl.Map({ container: elB!, ...opts, attributionControl: false })
    mapB.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapB.addControl(new maplibregl.FullscreenControl({ container: (box!.closest('.lens') as HTMLElement | null) ?? box! }), 'top-right')
    mapA.addControl(new maplibregl.ScaleControl(), 'bottom-left')
    const unsync = syncMaps(mapA, mapB)
    let n = 0
    const loaded = () => { if (++n === 2) { ready = true; fit(); onmaps?.(mapA!, mapB!) } }
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
    mapA.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: untrack(() => padding), maxZoom: 10, animate: false })
  }
  // re-fit when the place (its bounds) changes; the key keeps a same-valued array from refitting
  let fitKey = ''
  $effect(() => {
    const k = JSON.stringify(bounds)
    if (ready && k !== fitKey) { fitKey = k; fit() }
  })
  // the theme flips the basemap layers in place and recolours the outline
  $effect(() => {
    const d = dark
    if (!ready) return
    for (const m of [mapA, mapB]) { setBasemap(m, d); m?.setPaintProperty('outline', 'line-color', d ? '#eaf3f7' : '#111') }
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
  {#if leftLabel}
    <div class="cap l" style:right={single ? null : `calc(${(1 - pos) * 100}% + 10px)`} style:left={single ? '50%' : null}
         style:transform={single ? 'translateX(-50%)' : null}>{leftLabel}</div>
  {/if}
  {#if rightLabel && !single}
    <div class="cap r" style:left="calc({pos * 100}% + 10px)">{rightLabel}</div>
  {/if}
  <div class="attr">{@html dark ? DARK_ATTRIBUTION : OCEAN_ATTRIBUTION}</div>
</div>

<style>
  /* the map is the page: fill the lens's positioned stage */
  .box    { position: absolute; inset: 0; overflow: hidden; }
  .m      { position: absolute; inset: 0; }
  .cap    { position: absolute; top: 8px; z-index: 6; padding: 2px 8px; border-radius: 4px; pointer-events: none; white-space: nowrap;
            font: 600 12px/1.4 var(--font-sans); color: var(--text-strong); background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
            box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,.2)); }
  .attr   { position: absolute; right: 4px; bottom: var(--map-bottom, 4px); z-index: 3; max-width: 60%; padding: 1px 6px;
            border-radius: 3px; font: 10px/1.4 var(--font-sans); color: var(--text-muted); background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
            pointer-events: none; text-align: right; }
  .slider { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,.6);
            z-index: 5; cursor: ew-resize; touch-action: none; }
  .slider span { position: absolute; top: 50%; left: -17px; width: 32px; height: 32px; margin-top: -16px; border-radius: 50%;
                 background: #fff; box-shadow: 0 0 4px rgba(0,0,0,.5); font: 600 13px/32px system-ui; text-align: center; color: #333; user-select: none; }
</style>
