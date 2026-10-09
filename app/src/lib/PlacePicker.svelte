<script lang="ts">
  // the Place picker: the kit's Picker look (search box, "A–Z | by group", groups, keyboard) over the
  // whole gazetteer index. The kit's Picker filters the items it is given, so it cannot sit on 14,734
  // rows (one DOM row each) or run a ranked search of its own; this one lists a curated set of
  // collections without a query and the client's ranked search with one (see placePicker.ts for the rules).
  import { azRows, defaultView, searchView, type PickRow } from './placePicker'
  import { placeKey } from './gazetteer'
  import type { IndexPlace, Layer } from './places'

  interface Props {
    /** the selectable rows: every polygon place of the index */
    polygons  : IndexPlace[]
    layers    : Layer[]
    /** the selected place, as `placeKey()` */
    value     : string
    /** the client's ranked search over the whole index, polygons only; every hit, best first */
    search    : (q: string) => Promise<IndexPlace[]>
    onselect  : (row: IndexPlace) => void
    placeholder?: string
    maxHeight ?: string
    /** in the fill Controls the list takes the pane's height, as the kit's Picker `fill` (@marinebon/ui 0.4.0) */
    fill      ?: boolean
    label     ?: string
  }
  let { polygons, layers, value, search, onselect, placeholder = 'Search places…', maxHeight = '11rem', fill = false, label = 'places' }: Props = $props()

  const uid = `pp${Math.random().toString(36).slice(2, 7)}`
  let query    = $state('')
  let mode     = $state<'group' | 'az'>('group')
  let expanded = $state(false)
  let active   = $state(0)
  let listEl   = $state<HTMLElement>()
  // the ranked hits of the current query (null = no query); the newest search wins
  let hits      = $state.raw<IndexPlace[] | null>(null)
  let searching = $state(false)
  let failed    = $state('')
  let seq = 0
  $effect(() => {
    const q = query.trim()
    if (!q) { seq++; hits = null; searching = false; failed = ''; return }
    const mine = ++seq
    searching = true
    const t = setTimeout(async () => {
      try { const r = await search(q); if (mine === seq) { hits = r; failed = '' } }
      catch (e) { if (mine === seq) { hits = []; failed = e instanceof Error ? e.message : String(e) } }
      finally { if (mine === seq) searching = false }
    }, 120)
    return () => clearTimeout(t)
  })

  const def      = $derived(defaultView(polygons, layers, expanded))
  const found    = $derived(hits ? searchView(hits, layers) : null)
  const sections = $derived(found ? found.sections : def.sections)
  const flat     = $derived<PickRow[]>(mode === 'az' ? azRows(sections) : sections.flatMap((s) => s.rows))
  const index    = $derived(new Map(flat.map((r, i) => [r.key, i])))

  // reset the highlighted row when the list changes: the selected one, or the first hit
  $effect(() => {
    void query; void mode; void expanded
    const i = flat.findIndex((r) => r.key === value)
    active = query.trim() ? 0 : Math.max(0, i)
  })
  $effect(() => {
    const r = flat[active]
    if (!r || !listEl) return
    const el = listEl.querySelector<HTMLElement>(`[id="${uid}-o-${active}"]`)
    if (!el) return
    const top = el.offsetTop                       // the list is `position: relative`, so it is the row's offsetParent
    if (top < listEl.scrollTop) listEl.scrollTop = top
    else if (top + el.offsetHeight > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = top + el.offsetHeight - listEl.clientHeight
  })

  const pick = (r?: PickRow) => { if (r) onselect(r.row) }
  const clamp = (n: number) => Math.max(0, Math.min(flat.length - 1, n))
  function onkeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); active = clamp(active + 1); break
      case 'ArrowUp':   e.preventDefault(); active = clamp(active - 1); break
      case 'PageDown':  e.preventDefault(); active = clamp(active + 8); break
      case 'PageUp':    e.preventDefault(); active = clamp(active - 8); break
      case 'Enter':     e.preventDefault(); pick(flat[active]); break
      case 'Escape':    if (query) { e.preventDefault(); e.stopPropagation(); query = '' } break
    }
  }
  const n = (x: number) => x.toLocaleString('en-US')
</script>

<div class="pp" class:fill>
  <div class="bar">
    <input type="search" class="q" role="combobox" aria-label="Search {label}" aria-expanded="true"
           aria-controls="{uid}-list" aria-autocomplete="list"
           aria-activedescendant={flat[active] ? `${uid}-o-${active}` : undefined}
           {placeholder} autocomplete="off" spellcheck="false" bind:value={query} {onkeydown} />
    <div class="mode" role="group" aria-label="sort">
      <button type="button" aria-pressed={mode === 'az'} onclick={() => (mode = 'az')}>A–Z</button>
      <button type="button" aria-pressed={mode === 'group'} onclick={() => (mode = 'group')}>by group</button>
    </div>
  </div>
  <div class="list" bind:this={listEl} style:max-height={maxHeight}>
    <div id="{uid}-list" role="listbox" aria-label={label}>
      {#if mode === 'az'}
        {@render rows(flat)}
      {:else}
        {#each sections as s (s.slug)}
          <div role="group" aria-labelledby="{uid}-g-{s.slug}">
            <div class="ghead mbon-label" id="{uid}-g-{s.slug}" role="presentation">{s.title}</div>
            {@render rows(s.rows)}
            {#if s.more}<p class="more">… {n(s.more)} more{query.trim() ? ' matches here, add a word to narrow' : ', type to search'}</p>{/if}
          </div>
        {/each}
      {/if}
    </div>
    {#if !query.trim() && def.hiddenGroups}
      <button type="button" class="expand" onclick={() => (expanded = true)}>show {def.hiddenGroups} more collection{def.hiddenGroups === 1 ? '' : 's'} ({n(def.hiddenPlaces)} places)</button>
    {:else if !query.trim() && expanded}
      <button type="button" class="expand" onclick={() => (expanded = false)}>show fewer collections</button>
    {/if}
    {#if found && found.total > found.shown}
      <p class="more">showing {n(found.shown)} of {n(found.total)} matches; add a word to narrow</p>
    {/if}
    {#if failed}
      <p class="empty">search failed: {failed}</p>
    {:else if query.trim() && !searching && !flat.length}
      <p class="empty">No matches</p>
    {:else if searching && !flat.length}
      <p class="empty">searching…</p>
    {/if}
  </div>
  <span class="mbon-sr-only" aria-live="polite">{flat.length} {flat.length === 1 ? 'result' : 'results'}</span>
</div>

{#snippet rows(list: PickRow[])}
  {#each list as r (r.key)}
    {@const i = index.get(r.key) ?? -1}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div id="{uid}-o-{i}" role="option" class="opt" class:active={i === active} aria-selected={r.key === value}
         tabindex="-1" onclick={() => pick(r)} onpointermove={() => (active = i)}>
      <span class="sw" aria-hidden="true"></span>
      <span class="two">
        <span class="lab">{r.row.name}</span>
        <span class="sub">{r.row.place_id}</span>
      </span>
      {#if r.precomputed}<span class="pre" title="its statistics are computed weekly and read from a file, not recomputed in your browser">✓ precomputed</span>{/if}
    </div>
  {/each}
{/snippet}

<style>
  .pp { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  /* in a fill pane (not a phone sheet) the list takes the height left to it, like the kit's Picker fill */
  :global(.mbon-pane.fill) .pp.fill { flex: 1; min-height: 0; }
  :global(.mbon-pane.fill) .pp.fill .list { flex: 1; min-height: 8rem; max-height: none !important; }
  .bar { display: flex; gap: var(--space-2); align-items: center; }
  .q {
    flex: 1; min-width: 0; padding: 0.5em 0.75em; font: var(--type-small); color: var(--text-strong);
    background: var(--control-bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  }
  .q::placeholder { color: var(--text-muted); }
  .mode { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; flex: none; }
  .mode button {
    border: 0; background: transparent; padding: 0.45em 0.6em; cursor: pointer;
    font: var(--fw-medium) var(--text-xs) / 1 var(--font-mono); color: var(--text-body);
  }
  .mode button[aria-pressed='true'] { background: var(--selected-bg); color: var(--text-strong); }
  .list { position: relative; overflow: auto; overscroll-behavior: contain; margin: 0 calc(-1 * var(--space-1)); }
  .ghead { padding: var(--space-2) var(--space-2) var(--space-1); }
  .opt {
    display: flex; align-items: center; gap: var(--space-2); padding: 0.25em var(--space-2);
    border-radius: var(--radius-sm); font: var(--type-small); color: var(--text-heading); cursor: pointer;
  }
  .opt.active { background: var(--control-hover); }
  .opt[aria-selected='true'] { background: var(--selected-bg); color: var(--text-strong); font-weight: var(--fw-semibold); }
  .sw { flex: none; width: 0.75rem; height: 0.75rem; border-radius: 3px; background: var(--facet-place); }
  .two { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .lab { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--text-xs) / 1.2 var(--font-mono); color: var(--text-muted); font-weight: var(--fw-regular, 400); }
  .pre { flex: none; font: var(--text-xs) / 1 var(--font-mono); color: var(--text-muted); white-space: nowrap; }
  .more, .empty { margin: var(--space-1) var(--space-2); font: var(--type-small); color: var(--text-muted); }
  .expand {
    display: block; width: calc(100% - 2 * var(--space-2)); margin: var(--space-2); padding: 0.4em 0.6em; cursor: pointer;
    font: var(--type-small); color: var(--text-body); background: transparent; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm);
  }
  .expand:hover { background: var(--control-hover); }
</style>
