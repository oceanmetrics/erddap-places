<script lang="ts" module>
  // the basemap: Esri's World Ocean Base raster tiles, which need no key and no account. ArcGIS REST
  // tile URLs are `/tile/{z}/{y}/{x}` — row before column, unlike XYZ's {z}/{x}/{y}.
  export const OCEAN_TILES =
    'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'
  export const OCEAN_ATTRIBUTION =
    'Tiles &copy; Esri — GEBCO, NOAA, National Geographic, Garmin, HERE, and others'
</script>

<script lang="ts">
  // the map: gazetteer places from the published PMTiles archive (outline for all, fill for the
  // selected one, click to select) and, after a run, the last time step of the slab as one square
  // per masked grid cell.
  //
  // basemap: Esri's World Ocean Base raster tiles, which need no key and no account, with their
  // attribution. no geometry ever comes through this component as deep $state — App.svelte passes
  // the squares as a plain object built by cells.ts.
  import { CircleLayer, FillLayer, GeoJSON, LineLayer, MapLibre, Popup, VectorTileSource } from 'svelte-maplibre'
  import maplibregl, { LngLatBounds, type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'
  import { Protocol } from 'pmtiles'
  import type { FeatureCollection } from 'geojson'
  import type { CellProps } from './cells'
  import { PLACES_SOURCE_LAYER } from './gazetteer'

  interface Props {
    /** `pmtiles://…/places.pmtiles` is built from this (the gazetteer base that answered). */
    pmtilesUrl : string
    placeId    : string
    onselect  ?: (placeId: string) => void
    /** [west, south, east, north]; east may exceed 180 for an antimeridian place. */
    bounds    ?: [number, number, number, number] | null
    /** the last time step's grid cells, from cellSquares() */
    squares   ?: FeatureCollection | null
    /** tabledap sample stations, from cellPoints(): circles instead of squares */
    points    ?: FeatureCollection | null
    /** MapLibre fill-color expression (or colour) for the cells */
    fillColor ?: any
    /** what the hover popup calls the value */
    valueLabel?: string
    /** how the hover popup renders a value (a class label, or a number with units) */
    valueText ?: (v: number) => string
    /** the date of the drawn time step, for the corner caption */
    stepDate  ?: string
    legend    ?: { label: string; color: string }[]
    /** what the hover popup calls the weight (the area weight of a cell, the n behind a station) */
    weightLabel?: string
    weightText ?: (v: number) => string
  }
  let {
    pmtilesUrl, placeId, onselect, bounds = null, squares = null, points = null,
    fillColor = '#1f77b4', valueLabel = 'value', valueText = (v: number) => String(v),
    stepDate = '', legend = [], weightLabel = 'area weight',
    weightText = (v: number) => v.toFixed(3),
  }: Props = $props()

  // the pmtiles:// protocol, registered once per page
  if (!(globalThis as any).__pmtilesProtocol) {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)
    ;(globalThis as any).__pmtilesProtocol = protocol
  }

  const style: StyleSpecification = {
    version: 8,
    sources: {
      ocean: {
        type       : 'raster',
        tiles      : [OCEAN_TILES],
        tileSize   : 256,
        maxzoom    : 13,
        attribution: OCEAN_ATTRIBUTION,
      },
    },
    layers: [{ id: 'ocean', type: 'raster', source: 'ocean' }],
  }

  let map = $state.raw<maplibregl.Map | undefined>(undefined)
  const src = $derived(`pmtiles://${pmtilesUrl}`)
  // a place id the tiles can be filtered by; '' matches nothing, which is what we want before load
  const selected = $derived(['==', ['get', 'place_id'], placeId] as any)

  /**
   * The camera, driven **only** through `<MapLibre bind:bounds>`.
   *
   * Never also pass `center`/`zoom`, and never call `map.fitBounds()` from here: svelte-maplibre's
   * camera $effect reads `center`/`zoom` and eases the map whenever they differ from
   * `map.getCenter()`, while its `moveend` handler writes them back. A `center={[lng, lat]}` array
   * is never `compare`-equal to the `LngLat` the map returns, so the two chase each other until
   * Svelte throws `effect_update_depth_exceeded` — which is exactly what broke the deployed build
   * (regression test: `mapView.svelte.test.ts`). `bounds` is compared with `boundsEqual()`, which
   * wraps longitudes, so it settles after one fit and handles an east-of-180 box (PMNM) too.
   */
  let view = $state.raw<LngLatBoundsLike | undefined>(undefined)
  const fitBoundsOptions = { padding: 30, maxZoom: 11 }
  const fittable = (b: typeof bounds): b is [number, number, number, number] =>
    !!b && b[2] > b[0] && b[3] > b[1]
  // this effect writes `view` but never reads it: the map's own write-back cannot restart it
  $effect(() => {
    const b = bounds
    if (fittable(b)) view = new LngLatBounds([b[0], b[1]], [b[2], b[3]])
  })

  /**
   * Re-fit once the map has loaded.
   *
   * The place is already picked on first paint (from the hash, or the default), so `view` is set
   * before the map exists — and a fit asked for before `load` lands on a container that has not been
   * sized yet and is dropped, which left the page opening on the whole world with a sanctuary
   * selected. Assigning a **fresh** LngLatBounds here re-runs svelte-maplibre's bounds effect, which
   * then finds the map still showing the world and fits it for real. This is an event handler, not
   * an effect, and it runs once, so nothing reads what it writes.
   */
  let refitted = false
  function onload() {
    if (refitted) return
    refitted = true
    const b = bounds
    if (fittable(b)) view = new LngLatBounds([b[0], b[1]], [b[2], b[3]])
  }
</script>

{#snippet cellPopup()}
  <Popup openOn="hover" closeOnMove focusAfterOpen={false}>
    {#snippet children({ data })}
      {@const p = (data?.properties ?? {}) as CellProps}
      <div class="pop">
        <div><b>{valueLabel}</b>: {p.value === null || p.value === undefined ? 'no data' : valueText(Number(p.value))}</div>
        <div>{weightLabel}: {weightText(Number(p.weight))}</div>
        <div class="ll">{Number(p.lat).toFixed(3)}, {Number(p.lon).toFixed(3)}</div>
      </div>
    {/snippet}
  </Popup>
{/snippet}

<div class="map">
  <MapLibre {style} bind:map bind:bounds={view} {fitBoundsOptions} {onload} class="ml"
            standardControls attributionControl={{ compact: true }}>
    <VectorTileSource id="places" url={src} minzoom={0} maxzoom={12}>
      <!-- every place, outlined; clicking anywhere in one selects it in the picker -->
      <FillLayer
        sourceLayer={PLACES_SOURCE_LAYER}
        paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.04 }}
        hoverCursor="pointer"
        onclick={(e) => { const id = e.features?.[0]?.properties?.place_id; if (id) onselect?.(String(id)) }} />
      <LineLayer
        sourceLayer={PLACES_SOURCE_LAYER}
        paint={{ 'line-color': '#2266cc', 'line-width': 0.8, 'line-opacity': 0.75 }} />
      <!-- and the selected place, filled -->
      <FillLayer
        sourceLayer={PLACES_SOURCE_LAYER}
        filter={selected}
        interactive={false}
        paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.18, 'fill-outline-color': '#14448c' }} />
    </VectorTileSource>

    {#if squares}
      <GeoJSON id="cells" data={squares}>
        <FillLayer
          paint={{ 'fill-color': fillColor, 'fill-opacity': 0.8, 'fill-outline-color': 'rgba(0,0,0,0.12)' }}
          hoverCursor="crosshair">
          {@render cellPopup()}
        </FillLayer>
      </GeoJSON>
    {/if}

    {#if points}
      <!-- tabledap: one circle per sample station, same colour ramp and same popup -->
      <GeoJSON id="stations" data={points}>
        <CircleLayer
          paint={{ 'circle-color': fillColor, 'circle-opacity': 0.9, 'circle-radius': 5,
                   'circle-stroke-width': 1, 'circle-stroke-color': '#33333388' }}
          hoverCursor="crosshair">
          {@render cellPopup()}
        </CircleLayer>
      </GeoJSON>
    {/if}
  </MapLibre>

  {#if stepDate}
    <div class="caption">{valueLabel} — {stepDate}</div>
  {/if}
  {#if legend.length}
    <div class="legend">
      {#each legend as l}<span class="key"><i style="background:{l.color}"></i>{l.label}</span>{/each}
    </div>
  {/if}
</div>

<style>
  .map    { position: relative; height: 420px; width: 100%; margin: 1rem 0; border: 1px solid #ddd; border-radius: 3px; overflow: hidden; }
  .map :global(.ml) { height: 100%; width: 100%; }
  .caption { position: absolute; top: 8px; left: 8px; background: rgba(255,255,255,.88); padding: 2px 6px;
             font: 12px system-ui, sans-serif; border-radius: 3px; pointer-events: none; }
  .legend { position: absolute; bottom: 8px; left: 8px; max-width: 70%; background: rgba(255,255,255,.88);
            padding: 3px 6px; border-radius: 3px; font: 11px system-ui, sans-serif; pointer-events: none;
            display: flex; flex-wrap: wrap; gap: 2px 8px; }
  .key    { display: inline-flex; align-items: center; gap: 4px; }
  .key i  { width: 10px; height: 10px; display: inline-block; border: 1px solid #999; }
  .pop    { font: 12px/1.4 system-ui, sans-serif; }
  .ll     { color: #666; }
  @media (max-width: 640px) { .map { height: 300px; } }
</style>
