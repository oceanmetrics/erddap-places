<script lang="ts">
  // the page: MBON header (app name, the lens word, Help ▾, theme), one lens drawn on the map stage,
  // one footer line. the lens is part of the URL (`lens=then-now`; the old `mode=then-now` still
  // opens it and is rewritten), and switching lens swaps the component in place: no reload.
  import { Footer, Header, Kbd, Pane } from '@marinebon/ui'
  import App from './App.svelte'
  import { chrome } from './lib/chrome.svelte'
  import { LENS_LABEL, lensHash, lensOf, migrateHash, type Lens, type Panes } from './lib/view'

  const SOURCE = 'https://github.com/oceanmetrics/erddap-places'
  const GUIDE  = 'https://github.com/oceanmetrics/erddap-places#readme'

  // the old `#mode=…` links: rewrite the hash once, before the lens reads it
  if (typeof location !== 'undefined') {
    const h = migrateHash(location.hash)
    if (h !== location.hash) history.replaceState(null, '', location.pathname + location.search + h)
  }
  let current = $state<Lens>(typeof location === 'undefined' ? 'stats' : lensOf(location.hash))
  // the Then vs Now chunk (geotiff, the swipe map) is fetched only when that lens is opened
  const loadThenNow = () => import('./lib/thenNow/ThenNow.svelte').then((m) => m.default)

  /** open another lens with the place (and the pane layout) carried over; Back returns. */
  function setLens(to: Lens, carry: { place?: string; variable?: string; panes?: Panes } = {}) {
    if (to === current) return
    history.pushState(null, '', location.pathname + location.search + lensHash(to, carry))
    chrome.release = ''; chrome.timing = ''; chrome.busy = false; chrome.step = ''
    current = to
  }
  // a pasted link or Back/Forward that changes the lens switches it in place
  $effect(() => {
    const on = () => {
      const h = migrateHash(location.hash)
      if (h !== location.hash) history.replaceState(null, '', location.pathname + location.search + h)
      const l = lensOf(h)
      if (l !== current) current = l
    }
    addEventListener('hashchange', on)
    addEventListener('popstate', on)
    return () => { removeEventListener('hashchange', on); removeEventListener('popstate', on) }
  })

  // Help ▾ opens one card over the map
  let helpOpen  = $state(false)
  let helpTopic = $state<'about' | 'data' | 'keys'>('about')
  const HELP_TITLE = { about: 'about', data: 'data sources & attribution', keys: 'keyboard' }
  function openHelp(topic: typeof helpTopic, close: () => void) { helpTopic = topic; helpOpen = true; close() }
</script>

<div class="shell" data-lens={current} data-busy={chrome.busy ? '1' : '0'}>
  <Header appName="erddap-places" tagline="place statistics from ERDDAP, in your browser" appHref="./">
    {#snippet lens()}{LENS_LABEL[current]}{/snippet}
    {#snippet help(close)}
      <span class="mbon-label">help</span>
      <button type="button" onclick={() => openHelp('about', close)}>About</button>
      <button type="button" onclick={() => openHelp('data', close)}>Data sources &amp; attribution</button>
      <button type="button" onclick={() => openHelp('keys', close)}>Keyboard</button>
      <button type="button" disabled title="coming soon">Guided tour (soon)</button>
      <button type="button" disabled title="coming soon">User guide (soon)</button>
      <a href={SOURCE} target="_blank" rel="noreferrer" onclick={close}>Source code</a>
    {/snippet}
    {#snippet feedback()}<a class="fb" href="{SOURCE}/issues" target="_blank" rel="noreferrer">Feedback</a>{/snippet}
  </Header>

  <div class="body">
    {#key current}
      {#if current === 'stats'}
        <App {setLens} />
      {:else}
        {#await loadThenNow()}
          <div class="loading mbon-label">loading Then vs Now…</div>
        {:then ThenNow}
          <ThenNow {setLens} />
        {:catch e}
          <div class="loading">could not load Then vs Now: {String(e?.message ?? e)}</div>
        {/await}
      {/if}
    {/key}

    {#if helpOpen}
      <div class="help-layer">
      <Pane title={HELP_TITLE[helpTopic]} id="help" anchor="top-right" offset={{ x: 12, y: 8 }} width={380}
            closable bind:open={helpOpen} expandable={false}>
        <div class="help pane-col">
          {#if helpTopic === 'about'}
            <p><b>erddap-places</b> answers "what were the conditions in this place, over this time?" for a
               marine place (a national marine sanctuary, a MarineRegions or ProtectedSeas area) and a
               gridded ERDDAP dataset. The place is masked onto the grid, one request per lobe goes
               straight to the ERDDAP server, and DuckDB-WASM computes the statistics in this browser:
               no server of ours is in the request path.</p>
            <p><b>Then vs Now</b> compares one day of the year in a sanctuary with a climatology (or any
               range of years), from cloud-optimised GeoTIFFs read band by band. It rebuilds the
               <a href="https://shiny.marinebon.app/nms-cc" target="_blank" rel="noreferrer">nms-cc Shiny app</a> without a server.</p>
            <p>Every view is a link: the address bar carries the place, the data, the method, the window and
               which panes are open. A product of the
               <a href="https://marinebon.org" target="_blank" rel="noreferrer">Marine Biodiversity Observation Network</a>,
               built by <a href="https://oceanmetrics.io" target="_blank" rel="noreferrer">Ocean Metrics</a>.</p>
          {:else if helpTopic === 'data'}
            <p><b>Gridded data</b> come live from each dataset's ERDDAP server (PacIOOS for NOAA Coral Reef
               Watch, CoastWatch and others); the Share tab names the dataset, its producer and the exact
               requests. Cite the producer named there.</p>
            <p><b>Places</b>: the Ocean Metrics gazetteer of NOAA national marine sanctuaries (ONMS),
               <a href="https://www.marineregions.org" target="_blank" rel="noreferrer">MarineRegions.org</a> (MRGID) and
               <a href="https://protectedseas.net" target="_blank" rel="noreferrer">ProtectedSeas</a> (PSGID), published as
               GeoParquet and PMTiles with a <a href="https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/catalog.json" target="_blank" rel="noreferrer">STAC catalog</a>.</p>
            <p><b>Then vs Now</b>: NOAA Coral Reef Watch CoralTemp SST (5 km, daily, 1985 onward), clipped to
               each sanctuary's box as yearly 366-band COGs with day-of-year climatologies.</p>
            <p><b>Basemaps</b>: Esri World Ocean Base (light) and World Dark Gray Base (dark).</p>
          {:else}
            <ul class="keys">
              <li><Kbd>Tab</Kbd> moves through the sentence chips, the tabs and the panes</li>
              <li><Kbd>Enter</Kbd> opens a chip; <Kbd>Esc</Kbd> closes it and returns to the chip</li>
              <li><Kbd>←</Kbd> <Kbd>→</Kbd> switch the Controls tabs</li>
              <li>on a pane title: arrows move it, <Kbd>Home</Kbd> sends it home</li>
              <li>on the Time strip: drag or arrows move the window, <Kbd>Shift</Kbd>+arrows resize it, <Kbd>Esc</Kbd> clears</li>
              <li>in a picker: type to search, <Kbd>↑</Kbd> <Kbd>↓</Kbd> then <Kbd>Enter</Kbd></li>
            </ul>
            <p class="pane-note">Guide: <a href={GUIDE} target="_blank" rel="noreferrer">README</a></p>
          {/if}
        </div>
      </Pane>
      </div>
    {/if}
  </div>

  {#snippet timingLine()}<span class="status" aria-live="polite">{chrome.busy ? `updating… ${chrome.step}` : chrome.timing}</span>{/snippet}
  {#snippet releaseLine()}{chrome.release}{/snippet}
  <Footer sourceHref={SOURCE} release={chrome.release ? releaseLine : undefined} timing={chrome.busy || chrome.timing ? timingLine : undefined} />
</div>

<style>
  .shell  { height: 100%; display: flex; flex-direction: column; background: var(--bg-page); }
  .body   { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .loading { margin: auto; color: var(--text-muted); }
  /* Help sits over the sentence and the map; only the card itself takes the pointer */
  .help-layer { position: absolute; inset: 0; z-index: 40; pointer-events: none; }
  .help-layer > :global(*) { pointer-events: auto; }
  .help p { margin: 0; font: var(--type-small); }
  .keys   { margin: 0; padding-left: 1.1rem; font: var(--type-small); display: flex; flex-direction: column; gap: 6px; }
  .fb     { font: var(--type-small); }
  .shell :global(.mbon-footer) { flex: none; }
  .status { font-family: var(--font-mono); }
  @media (max-width: 640px) { .fb { display: none; } }
</style>
