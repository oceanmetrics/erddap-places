<script lang="ts">
  // the page: MBON header (app name, the lens word, Help ▾, Feedback, theme), one lens drawn on the map
  // stage, one footer line. the lens is part of the URL (`lens=then-now`; the old `mode=then-now` still
  // opens it and is rewritten), and switching lens swaps the component in place: no reload.
  // Help, the tour and feedback live here too (after calcofi.io/explore and obis-hex): the welcome
  // card, the tour, the Help modals, the shortcuts, and the feedback dialog (a lazy chunk with
  // html-to-image). The lens on screen registers a LensApi so the tour and keys can open its tabs.
  import { onMount, type Component } from 'svelte'
  import { Button, Footer, Header, Kbd, toggleTheme } from '@marinebon/ui'
  import App from './App.svelte'
  import { chrome, theme } from './lib/chrome.svelte'
  import { LENS_LABEL, lensHash, lensOf, migrateHash, type Lens, type Panes } from './lib/view'
  import Modal from './lib/help/Modal.svelte'
  import Welcome from './lib/help/Welcome.svelte'
  import Tour from './lib/help/Tour.svelte'
  import { onLoad, pageBase, parseHelpQuery, withoutHelpQuery, WELCOME_SEEN_KEY, type HelpModal, type StartView } from './lib/help/start'
  import { OWNS_ARROWS, shortcutFor, SHORTCUTS } from './lib/help/keys'
  import { datasetSources, fixedSources, type Source } from './lib/help/sources'
  import { APP_REPO } from './lib/help/cite'
  import type { TourStop } from './lib/help/tour'
  import type { LensApi, LensUi } from './lib/help/lensApi'
  import type { FeedbackKind } from './lib/feedback/issue'
  import { loadDatasets, type Dataset } from './lib/catalog'

  const SOURCE = APP_REPO
  const GUIDE  = 'https://marinebon.org/tools/erddap-places/'

  // the old `#mode=…` links: rewrite the hash once, before the lens reads it
  if (typeof location !== 'undefined') {
    const h = migrateHash(location.hash)
    if (h !== location.hash) history.replaceState(null, '', location.pathname + location.search + h)
  }
  let current = $state<Lens>(typeof location === 'undefined' ? 'stats' : lensOf(location.hash))
  // a door of the welcome card re-mounts the lens on its new hash (the lenses read the hash once)
  let viewKey = $state(0)
  // the Then vs Now chunk (geotiff, the swipe map) is fetched only when that lens is opened
  const loadThenNow = () => import('./lib/thenNow/ThenNow.svelte').then((m) => m.default)

  /** open another lens with the place (and the pane layout) carried over; Back returns. */
  function setLens(to: Lens, carry: { place?: string; variable?: string; panes?: Panes } = {}) {
    if (to === current) return
    history.pushState(null, '', location.pathname + location.search + lensHash(to, carry))
    chrome.release = ''; chrome.timing = ''; chrome.busy = false; chrome.step = ''
    api = null
    current = to
  }
  // a pasted link or Back/Forward that changes the lens switches it in place
  $effect(() => {
    const on = () => {
      const h = migrateHash(location.hash)
      if (h !== location.hash) history.replaceState(null, '', location.pathname + location.search + h)
      const l = lensOf(h)
      if (l !== current) { api = null; current = l }
    }
    addEventListener('hashchange', on)
    addEventListener('popstate', on)
    return () => { removeEventListener('hashchange', on); removeEventListener('popstate', on) }
  })

  // ── help, the tour and feedback ───────────────────────────────────────────
  let api = $state.raw<LensApi | null>(null)
  const register = (a: LensApi) => { api = a }
  const helpQuery = typeof location === 'undefined' ? { tour: null, modal: null } as const : parseHelpQuery(location.search)
  const seen = (() => { try { return localStorage.getItem(WELCOME_SEEN_KEY) === '1' } catch { return true } })()
  const atLoad = onLoad(helpQuery, seen)
  // the switches did their job: drop them from the address bar, so a copied address is just the view
  if (typeof location !== 'undefined' && (helpQuery.tour || helpQuery.modal || /[?&](tour|modal)=/.test(location.search)))
    history.replaceState(history.state, '', location.pathname + withoutHelpQuery(location.search) + location.hash)
  let helpModal     = $state<HelpModal>(atLoad.modal ?? 'about')
  let helpModalOpen = $state(atLoad.modal !== null)
  let welcomeOpen   = $state(atLoad.welcome)
  let tourIndex     = $state(-1)
  let tourWas: LensUi | null = null
  let FeedbackDialog = $state.raw<Component<any> | null>(null)
  let fbOpen  = $state(false)
  let fbKind  = $state<FeedbackKind>('feedback')
  let fbImage = $state.raw<HTMLCanvasElement | null>(null)
  let fbBusy  = $state(false)
  let bodyEl: HTMLDivElement
  const MODAL_TITLE: Record<HelpModal, string> = { about: 'about', sources: 'data sources and attribution', keys: 'keyboard' }

  function showModal(m: HelpModal) { helpModal = m; helpModalOpen = true }
  function closeWelcome() {
    welcomeOpen = false
    try { localStorage.setItem(WELCOME_SEEN_KEY, '1') } catch { /* storage blocked: the card shows again next time */ }
  }
  const startHref = (v: StartView) => (typeof location === 'undefined' ? v.hash : location.pathname + withoutHelpQuery(location.search) + v.hash)
  function openStart(v: StartView) {
    closeWelcome()
    history.pushState(null, '', startHref(v))
    chrome.release = ''; chrome.timing = ''; chrome.busy = false; chrome.step = ''
    api = null
    current = lensOf(v.hash)
    viewKey++
  }
  function startTour() {
    if (welcomeOpen) closeWelcome()
    helpModalOpen = false
    if (tourIndex < 0) tourWas = api?.ui() ?? null
    tourIndex = 0
  }
  function tourStepped(s: TourStop) {
    if (s.tab) api?.setUi({ tab: s.tab, controls: true })
    if (s.time) api?.setUi({ time: true })
    if (s.timeTab) api?.setUi({ timeTab: s.timeTab })
  }
  function tourClosed() {
    if (tourWas) api?.setUi(tourWas)
    tourWas = null
  }

  async function openFeedback(kind: FeedbackKind) {
    if (fbBusy) return
    fbBusy = true
    if (welcomeOpen) closeWelcome()
    tourIndex = -1
    try {
      const [mod, cap] = await Promise.all([import('./lib/feedback/FeedbackDialog.svelte'), import('./lib/feedback/capture')])
      let image: HTMLCanvasElement | null = null
      try { image = await cap.captureView(bodyEl, api?.maps() ?? []) } catch (e) { console.warn('feedback: capture failed', e); image = null }
      FeedbackDialog = mod.default
      fbKind = kind; fbImage = image; fbOpen = true
    } finally { fbBusy = false }
  }
  const feedbackReport = () => ({
    url       : pageBase() + location.hash,
    lens      : LENS_LABEL[current],
    appVersion: `${__APP_VERSION__}${__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ''}`,
    version   : __APP_VERSION__,
    sha       : __APP_COMMIT__ || '',
    release   : chrome.release || null,
    viewport  : `${innerWidth}×${innerHeight}`,
    theme     : theme.dark ? 'dark' : 'light',
    sentence  : api?.sentence() ?? '',
  })

  // Help ▾ → Data sources and About read the catalog's collections (once, when first opened)
  let datasetsP: Promise<Dataset[]> | null = null
  let datasets = $state.raw<Dataset[]>([])
  $effect(() => {
    if (!helpModalOpen || helpModal === 'keys' || datasetsP) return
    datasetsP = loadDatasets()
    datasetsP.then((d) => { datasets = d }).catch(() => { datasetsP = null })
  })
  const today = new Date().toISOString().slice(0, 10)
  const sourceRows = $derived<Source[]>([...datasetSources(datasets, today), ...fixedSources(today.slice(0, 4))])
  const servers = $derived([...new Set(datasets.map((d) => { try { return new URL(d.baseUrl).host } catch { return d.baseUrl } }))])
  let aboutCite = $state('')
  $effect(() => { if (helpModalOpen && helpModal === 'about') aboutCite = api?.cite() ?? '' })
  let copied = $state('')
  async function copyCite() {
    try { await navigator.clipboard.writeText(aboutCite); copied = 'copied' } catch { copied = 'could not copy' }
    setTimeout(() => { copied = '' }, 2500)
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null
    const busy = tourIndex >= 0 || fbOpen || helpModalOpen || !!document.querySelector('dialog[open]')
    const s = shortcutFor({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
      targetTag: t?.tagName, targetEditable: !!t?.isContentEditable, targetOwnsArrows: !!t?.closest?.(OWNS_ARROWS) },
      { busy, lens: current })
    if (!s) return
    if (s.kind === 'escape') { if (welcomeOpen) closeWelcome(); return }   // menus, chips, panes, dialogs and the tour close themselves
    e.preventDefault()
    if (s.kind === 'tour') startTour()
    else if (s.kind === 'theme') toggleTheme()
    else if (s.kind === 'lens') api?.switchLens()
    else if (s.kind === 'tab') api?.setUi({ tab: s.tab, controls: true })
    else if (s.kind === 'day') api?.day?.(s.by)
  }
  onMount(() => {
    addEventListener('keydown', onKey)
    // the tour waits for the lens to register (it opens tabs); a moment is plenty
    let t: ReturnType<typeof setTimeout> | undefined
    if (atLoad.tour) t = setTimeout(startTour, 600)
    return () => { removeEventListener('keydown', onKey); clearTimeout(t) }
  })
</script>

<div class="shell" data-lens={current} data-busy={chrome.busy ? '1' : '0'}>
  <Header appName="erddap-places" tagline="place statistics from ERDDAP, in your browser" appHref="./">
    {#snippet lens()}{LENS_LABEL[current]}{/snippet}
    {#snippet help(close)}
      <button type="button" onclick={() => { close(); startTour() }}>Take the tour <span class="kbd-hint">?</span></button>
      <a href={GUIDE} target="_blank" rel="noopener" onclick={close}>Guide ↗</a>
      <button type="button" onclick={() => { close(); tourIndex = -1; welcomeOpen = true }}>Start here</button>
      <button type="button" onclick={() => { close(); showModal('about') }}>About</button>
      <button type="button" onclick={() => { close(); showModal('sources') }}>Data sources and attribution</button>
      <button type="button" onclick={() => { close(); showModal('keys') }}>Keyboard</button>
      <button type="button" onclick={() => { close(); openFeedback('product') }}>Register a product</button>
      <a href={SOURCE} target="_blank" rel="noopener" onclick={close}>Source code ↗</a>
    {/snippet}
    {#snippet feedback()}
      <button type="button" class="fb-bubble" aria-label="Send feedback" title="Send feedback (a picture of this view and your note)"
        aria-busy={fbBusy} disabled={fbBusy} onclick={() => openFeedback('feedback')}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 4.5h13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.6 2.8v-2.8H3.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
        <span class="fb-word">Feedback</span>
      </button>
    {/snippet}
  </Header>

  <div class="body" bind:this={bodyEl}>
    {#key `${current}|${viewKey}`}
      {#if current === 'stats'}
        <App {setLens} {register} />
      {:else}
        {#await loadThenNow()}
          <div class="loading mbon-label">loading Then vs Now…</div>
        {:then ThenNow}
          <ThenNow {setLens} {register} />
        {:catch e}
          <div class="loading">could not load Then vs Now: {String(e?.message ?? e)}</div>
        {/await}
      {/if}
    {/key}

    {#if welcomeOpen}
      <Welcome href={startHref} onopen={openStart} onclose={closeWelcome} ontour={startTour} />
    {/if}
  </div>

  <Modal bind:open={helpModalOpen} title={MODAL_TITLE[helpModal]} width={helpModal === 'keys' ? '30rem' : helpModal === 'sources' ? '48rem' : '40rem'}>
    <div class="help">
      {#if helpModal === 'about'}
        <p><b>erddap-places</b> answers "what were the conditions in this place, over this time?" for a marine
           place (a national marine sanctuary, a MarineRegions.org area or a ProtectedSeas area) and an ERDDAP
           dataset. <b>Window statistics</b> summarise the place day by day; <b>Then vs Now</b> sets one day of the
           year against a climatology, like the
           <a href="https://shiny.marinebon.app/nms-cc" target="_blank" rel="noopener">nms-cc Shiny app</a>, without a server.</p>
        <p><b>How it computes.</b> The place is masked onto the dataset's grid in your browser (each cell weighted by
           the share of its area inside the place); one request per lobe of the place goes straight to the ERDDAP
           server; DuckDB-WASM runs the SQL here. Then vs Now reads cloud-optimised GeoTIFFs one band at a time.
           No server of ours is in the request path, and every view is a link.</p>
        <p><b>What it reads.</b> The places and the dataset descriptions from the
           <a href="https://storage.oceanmetrics.io/gazetteer/catalog.json" target="_blank" rel="noopener">Ocean Metrics gazetteer</a>
           (STAC, GeoParquet, PMTiles); the data from {servers.length ? servers.length : 'the'} ERDDAP server{servers.length === 1 ? '' : 's'}{servers.length ? ':' : ''}
           {#each servers as s, i (s)}<span class="pane-mono">{s}</span>{i < servers.length - 1 ? ', ' : '.'}{/each}
           See <button type="button" class="linkish" onclick={() => showModal('sources')}>data sources and attribution</button>.</p>
        <p>A product of the <a href="https://marinebon.org" target="_blank" rel="noopener">Marine Biodiversity Observation Network</a>
           (MBON), built by <a href="https://oceanmetrics.io" target="_blank" rel="noopener">Ocean Metrics</a>. Code: MIT licence,
           <a href={SOURCE} target="_blank" rel="noopener">github.com/oceanmetrics/erddap-places</a>, v{__APP_VERSION__}{__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ''}.
           Data: each producer's terms.</p>
        {#if aboutCite}
          <span class="mbon-label">cite this data</span>
          <pre class="cite">{aboutCite}</pre>
          <div class="row"><Button variant="quiet" size="sm" onclick={copyCite}>Copy citation</Button>{#if copied}<span class="note" role="status">{copied}</span>{/if}</div>
        {/if}
      {:else if helpModal === 'sources'}
        {#if !datasets.length}<p class="note">reading the catalog…</p>{/if}
        <table class="sources">
          <tbody>
            {#each sourceRows as src (src.name + src.href)}
              <tr>
                <th scope="row"><a href={src.href} target="_blank" rel="noopener">{src.name}</a></th>
                <td>
                  {src.role}
                  {#if src.provider || src.server}<div class="l">{#if src.provider}Provider: {src.provider}{/if}{#if src.provider && src.server}{' · '}{/if}{#if src.server}Server: {src.server}{/if}</div>{/if}
                  {#if src.citation}<div class="c">{src.citation}</div>{/if}
                  {#if src.licence || src.doi}<div class="l">{#if src.licence}Licence: {#if src.licenceHref && !src.licence.includes(src.licenceHref)}<a href={src.licenceHref} target="_blank" rel="noopener">{src.licence}</a>{:else}{src.licence}{/if}{/if}{#if src.doi}{src.licence ? ' · ' : ''}DOI{' '} <a href="https://doi.org/{src.doi}" target="_blank" rel="noopener">{src.doi}</a>{/if}</div>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <table class="keys">
          <tbody>
            {#each SHORTCUTS as k (k.what)}
              <tr><td>{#each k.keys as key, i (key)}{#if i}&nbsp;{/if}<Kbd>{key}</Kbd>{/each}</td><td>{k.what}</td></tr>
            {/each}
          </tbody>
        </table>
        <ul>
          <li><Kbd>Tab</Kbd> moves through the sentence chips, the tabs and the panes; <Kbd>Enter</Kbd> opens a chip.</li>
          <li>On the Controls tabs, <Kbd>←</Kbd> <Kbd>→</Kbd> move between tabs.</li>
          <li>On a pane title, arrows move it, <Kbd>Home</Kbd> sends it home.</li>
          <li>On the Time strip, drag or arrows move the window, <Kbd>Shift</Kbd>+arrows resize it; on its Plot and Table tabs, <Kbd>←</Kbd> <Kbd>→</Kbd> switch.</li>
          <li>In a picker, type to search, <Kbd>↑</Kbd> <Kbd>↓</Kbd> then <Kbd>Enter</Kbd>.</li>
          <li>In the tour, <Kbd>←</Kbd> <Kbd>→</Kbd> move, <Kbd>Esc</Kbd> ends it.</li>
        </ul>
        <p class="note">Guide: <a href={GUIDE} target="_blank" rel="noopener">marinebon.org/tools/erddap-places</a></p>
      {/if}
    </div>
  </Modal>

  <Tour bind:index={tourIndex} onstep={tourStepped} onclose={tourClosed} />

  {#if FeedbackDialog}
    <FeedbackDialog bind:open={fbOpen} kind={fbKind} image={fbImage} report={feedbackReport}
      filename={`erddap-places_${fbKind}.png`} />
  {/if}

  {#snippet timingLine()}<span class="status" aria-live="polite">{chrome.busy ? `updating… ${chrome.step}` : chrome.timing}</span>{/snippet}
  {#snippet releaseLine()}{chrome.release}{/snippet}
  <Footer sourceHref={SOURCE} release={chrome.release ? releaseLine : undefined} timing={chrome.busy || chrome.timing ? timingLine : undefined} />
</div>

<style>
  .shell  { height: 100%; display: flex; flex-direction: column; background: var(--bg-page); }
  .body   { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .loading { margin: auto; color: var(--text-muted); }
  .shell :global(.mbon-footer) { flex: none; }
  .status { font-family: var(--font-mono); }
  .fb-bubble {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-body); cursor: pointer; font: var(--type-small);
  }
  .fb-bubble:hover { background: var(--control-hover); color: var(--text-strong); }
  .fb-bubble:disabled { opacity: 0.5; cursor: progress; }
  :global(.kbd-hint) { margin-left: auto; padding-left: var(--space-3); font: var(--text-xs) / 1 var(--font-mono); color: var(--text-muted); }
  .help p { margin: 0 0 var(--space-2); }
  .help .note { color: var(--text-muted); font: var(--text-xs) / 1.4 var(--font-sans); margin: 0; }
  .help .cite { white-space: pre-wrap; overflow-wrap: anywhere; font: var(--text-xs) / 1.45 var(--font-mono); background: var(--bg-tint); border-radius: var(--radius-sm); padding: var(--space-2); margin: var(--space-1) 0 var(--space-2); }
  .help .mbon-label { display: block; margin-top: var(--space-3); }
  .help .row { display: flex; gap: var(--space-2); align-items: center; }
  .help .linkish { border: 0; padding: 0; background: none; color: var(--link); font: inherit; cursor: pointer; }
  .help .pane-mono { font: var(--text-xs) / 1.4 var(--font-mono); }
  .help table { border-collapse: collapse; width: 100%; margin-bottom: var(--space-3); }
  .help th, .help td { text-align: left; vertical-align: top; padding: var(--space-2) var(--space-2) var(--space-2) 0; }
  .help table.sources tr + tr th, .help table.sources tr + tr td { border-top: 1px solid var(--divider); }
  .help table.sources th { width: 11rem; font-weight: var(--fw-semibold); }
  .help .c { margin-top: 2px; font: var(--text-xs) / 1.4 var(--font-mono); color: var(--text-strong); overflow-wrap: anywhere; }
  .help .l { margin-top: 2px; font: var(--text-xs) / 1.4 var(--font-sans); color: var(--text-muted); overflow-wrap: anywhere; }
  .help table.keys td:first-child { white-space: nowrap; width: 7rem; }
  .help ul { margin: 0 0 var(--space-2); padding-left: 1.1rem; display: flex; flex-direction: column; gap: 4px; }
  @media (max-width: 640px) { .fb-word { display: none; } .help table.sources th { width: 7rem; } }
</style>
