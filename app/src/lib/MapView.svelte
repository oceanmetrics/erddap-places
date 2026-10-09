<script lang="ts" module>
  // the basemap: Esri's World Ocean Base raster tiles, which need no key and no account. ArcGIS REST
  // tile URLs are `/tile/{z}/{y}/{x}` — row before column, unlike XYZ's {z}/{x}/{y}.
  export const OCEAN_TILES =
    'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'
  // the map credits each basemap in one short line, its full list in the hover title (and in Help → Data
  // sources), so the line leaves room for the place credits
  export const OCEAN_ATTRIBUTION =
    '<span title="Tiles &copy; Esri — GEBCO, NOAA, National Geographic, Garmin, HERE, and others">&copy; Esri — GEBCO, NOAA, …</span>'
  // the dark theme's basemap: Esri's keyless Dark Gray Canvas base, same tile scheme
  export const DARK_TILES =
    'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
  export const DARK_ATTRIBUTION =
    '<span title="Tiles &copy; Esri — Esri, HERE, Garmin, FAO, NOAA, USGS">&copy; Esri — HERE, Garmin, …</span>'

  /** both basemaps as raster sources + layers; the theme decides which one is visible. */
  export function basemapStyle(dark: boolean): Pick<import('maplibre-gl').StyleSpecification, 'sources' | 'layers'> {
    return {
      sources: {
        ocean: { type: 'raster', tiles: [OCEAN_TILES], tileSize: 256, maxzoom: 13, attribution: OCEAN_ATTRIBUTION },
        dark : { type: 'raster', tiles: [DARK_TILES],  tileSize: 256, maxzoom: 16, attribution: DARK_ATTRIBUTION },
      },
      layers: [
        { id: 'ocean', type: 'raster', source: 'ocean', layout: { visibility: dark ? 'none' : 'visible' } },
        { id: 'dark',  type: 'raster', source: 'dark',  layout: { visibility: dark ? 'visible' : 'none' } },
      ],
    }
  }
  /** show the basemap of a theme on a live map (a no-op until its style has the two layers). */
  export function setBasemap(map: { getLayer(id: string): unknown; setLayoutProperty(id: string, k: string, v: unknown): unknown } | null | undefined, dark: boolean) {
    if (!map?.getLayer('ocean') || !map.getLayer('dark')) return
    map.setLayoutProperty('ocean', 'visibility', dark ? 'none' : 'visible')
    map.setLayoutProperty('dark', 'visibility', dark ? 'visible' : 'none')
  }
</script>

<script lang="ts">
  // the map: gazetteer places from the published PMTiles archive (outline for all, fill for the
  // selected one, click to select) and, after a run, the last time step of the slab as one square
  // per masked grid cell.
  //
  // basemap: Esri's World Ocean Base raster tiles, which need no key and no account, with their
  // attribution. no geometry ever comes through this component as deep $state — App.svelte passes
  // the squares as a plain object built by cells.ts.
  import { CircleLayer, FillLayer, GeoJSON, LineLayer, MapLibre, NavigationControl, Popup, ScaleControl, VectorTileSource } from 'svelte-maplibre'
  import { untrack } from 'svelte'
  import maplibregl, { LngLatBounds, type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'
  import { Protocol } from 'pmtiles'
  import type { FeatureCollection } from 'geojson'
  import type { CellProps } from './cells'
  import { PLACES_SOURCE_LAYER, placesAttribution } from './gazetteer'

  interface Props {
    /** `pmtiles://…/places.pmtiles` is built from this (the gazetteer base that answered). */
    pmtilesUrl : string
    placeId    : string
    /** a place was clicked on the map: its id and the collection of the layer it belongs to */
    onselect  ?: (placeId: string, collection: string) => void
    /**
     * the selected place's collection when it is not `places`: its PMTiles (bucket URL), source-layer (the
     * slug) and credit. One extra source at a time; it replaces the selected fill and outline of the
     * `places` source and makes the collection's features clickable.
     */
    extra     ?: { slug: string; url: string; attribution: string } | null
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
    /** room to leave around a fitted place (the panes float over the map), read once at mount */
    padding   ?: number | { top: number; bottom: number; left: number; right: number }
    /** the dark theme's basemap instead of the ocean one */
    dark      ?: boolean
    /** the map instance, once it exists (for the PNG of the view) */
    onmap     ?: (map: maplibregl.Map) => void
    /** what the hover popup calls the weight (the area weight of a cell, the n behind a station) */
    weightLabel?: string
    weightText ?: (v: number) => string
  }
  let {
    pmtilesUrl, placeId, onselect, extra = null, bounds = null, squares = null, points = null,
    fillColor = '#1f77b4', valueLabel = 'value', valueText = (v: number) => String(v),
    dark = false, onmap, padding = 30, weightLabel = 'area weight',
    weightText = (v: number) => v.toFixed(3),
  }: Props = $props()

  // the pmtiles:// protocol, registered once per page
  if (!(globalThis as any).__pmtilesProtocol) {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)
    ;(globalThis as any).__pmtilesProtocol = protocol
  }

  // the style is built once (the theme at mount); a theme change flips the two basemap layers.
  // the default projection is the globe (MapLibre 5); bind:bounds fits work the same on it
  const style: StyleSpecification = { version: 8, projection: { type: 'globe' }, ...basemapStyle(untrack(() => dark)) }

  let map = $state.raw<maplibregl.Map | undefined>(undefined)
  const SELECTED_OUTLINE = 'selected-outline'
  // the cells and stations are inserted below the selected outline, so the outline stays on top after a
  // run: the extra collection's outline has its own id, and they follow whichever is on the map
  const EXTRA_FILL = 'extra-faint'
  const PLACES_FILL = 'places-faint'
  const outlineId = $derived(extra ? `${SELECTED_OUTLINE}-${extra.slug}` : SELECTED_OUTLINE)
  const src = $derived(`pmtiles://${pmtilesUrl}`)
  // a place id the tiles can be filtered by; '' matches nothing, which is what we want before load
  const selected = $derived(['==', ['get', 'place_id'], placeId] as any)
  // a click on a place of the `places` source selects it, unless a feature of the extra collection is under
  // the pointer too (the more specific layer wins)
  function clickedHome(e: any) {
    const id = e.features?.[0]?.properties?.place_id
    if (!id) return
    if (extra && map?.getLayer(EXTRA_FILL) && map.queryRenderedFeatures(e.point, { layers: [EXTRA_FILL] }).length) return
    onselect?.(String(id), 'places')
  }

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
  const fitBoundsOptions = { padding: untrack(() => padding), maxZoom: 11 }
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
  /**
   * The attribution: the basemap and the extra collection credit themselves (as sources), but the places
   * source holds three gazetteers, so it carries no credit of its own. The control's custom line names only
   * the gazetteers of the places on screen, checked whenever the map settles. A control's custom line is
   * fixed when it is added, so a new credit swaps the control, keeping it folded if it was.
   */
  let attrib: maplibregl.AttributionControl | null = null
  let placesCredit = ''
  function creditPlaces() {
    if (!map) return
    const ids = map.getLayer(PLACES_FILL)
      ? map.queryRenderedFeatures({ layers: [PLACES_FILL] }).map((f) => String(f.properties?.place_id ?? ''))
      : []
    const credit = placesAttribution(ids)
    if (attrib && credit === placesCredit) return
    const old = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
    const folded = !!old && old.classList.contains('maplibregl-compact') && !old.classList.contains('maplibregl-compact-show')
    if (attrib) map.removeControl(attrib)
    placesCredit = credit
    attrib = new maplibregl.AttributionControl({ compact: true, customAttribution: credit || undefined })
    map.addControl(attrib, 'bottom-right')
    if (folded) map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
  }

  let refitted = false
  // the theme switches the basemap in place: no setStyle, so the place and cell layers stay put
  $effect(() => { const d = dark, m = map; if (m) setBasemap(m, d) })
  function onload() {
    if (map) {
      setBasemap(map, dark); onmap?.(map)
      // fullscreen takes the whole lens (sentence bar, legend, panes, Time strip), not just the canvas
      const lens = map.getContainer().closest('.lens') as HTMLElement | null
      map.addControl(new maplibregl.FullscreenControl(lens ? { container: lens } : {}), 'top-right')
      creditPlaces()
      map.on('idle', creditPlaces)
    }
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
            attributionControl={false}>
    <!-- one row of map buttons at the top right; the title and the legend live in the sentence -->
    <NavigationControl position="top-right" />
    <ScaleControl position="bottom-left" />
    <VectorTileSource id="places" url={src} minzoom={0} maxzoom={12}>
      <!-- every place, outlined; clicking anywhere in one selects it in the picker. the attribution
           credits the gazetteers of the places this layer has on screen (creditPlaces) -->
      <FillLayer
        id={PLACES_FILL}
        sourceLayer={PLACES_SOURCE_LAYER}
        paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.04 }}
        hoverCursor="pointer"
        onclick={clickedHome} />
      <LineLayer
        sourceLayer={PLACES_SOURCE_LAYER}
        paint={{ 'line-color': '#2266cc', 'line-width': 0.8, 'line-opacity': 0.75 }} />
      {#if !extra}
        <!-- and the selected place, filled -->
        <FillLayer
          sourceLayer={PLACES_SOURCE_LAYER}
          filter={selected}
          interactive={false}
          paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.18, 'fill-outline-color': '#14448c' }} />
        <!-- and its outline, a real line; the cells and stations below are inserted beneath it
             (beforeId), so it stays visible after a run -->
        <LineLayer
          id={SELECTED_OUTLINE}
          sourceLayer={PLACES_SOURCE_LAYER}
          filter={selected}
          interactive={false}
          layout={{ 'line-join': 'round' }}
          paint={{ 'line-color': '#14448c', 'line-width': 2.5 }} />
      {/if}
    </VectorTileSource>

    {#if extra}
      <!-- the selected place's own collection: one more source, swapped when the collection changes. Its
           features are faint and clickable (they select), the selected one is filled and outlined. -->
      {#key extra.slug}
        <VectorTileSource id={`coll-${extra.slug}`} url={`pmtiles://${extra.url}`} minzoom={0} attribution={extra.attribution}>
          <FillLayer
            id={EXTRA_FILL}
            sourceLayer={extra.slug}
            paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.05 }}
            hoverCursor="pointer"
            onclick={(e) => { const id = e.features?.[0]?.properties?.place_id; if (id && extra) onselect?.(String(id), extra.slug) }} />
          <FillLayer
            sourceLayer={extra.slug}
            filter={selected}
            interactive={false}
            paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.18, 'fill-outline-color': '#14448c' }} />
          <LineLayer
            id={outlineId}
            sourceLayer={extra.slug}
            filter={selected}
            interactive={false}
            layout={{ 'line-join': 'round' }}
            paint={{ 'line-color': '#14448c', 'line-width': 2.5 }} />
        </VectorTileSource>
      {/key}
    {/if}

    {#if squares}
      <GeoJSON id="cells" data={squares}>
        <FillLayer
          beforeId={outlineId}
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
          beforeId={outlineId}
          paint={{ 'circle-color': fillColor, 'circle-opacity': 0.9, 'circle-radius': 5,
                   'circle-stroke-width': 1, 'circle-stroke-color': '#33333388' }}
          hoverCursor="crosshair">
          {@render cellPopup()}
        </CircleLayer>
      </GeoJSON>
    {/if}
  </MapLibre>
</div>

<style>
  /* the map is the page: it fills whatever positioned box the lens gives it */
  .map    { position: absolute; inset: 0; }
  .map :global(.ml) { height: 100%; width: 100%; }
  .pop    { font: 12px/1.4 var(--font-sans); color: #0f2230; }
  .ll     { color: #44606e; font-family: var(--font-mono); }
</style>
