<script lang="ts">
  // "Start here": a small card over the map on a first visit (and from Help ▾), with two doors and
  // three worked questions. Each is a real link (the page URL with the view's hash), so it can be
  // opened in a new tab; a plain click opens the view in place and closes the card.
  import { Button } from '@marinebon/ui'
  import { doors, QUESTIONS, type StartView } from './start'

  let { href, onopen, onclose, ontour }: {
    href: (v: StartView) => string
    onopen: (v: StartView) => void
    onclose: () => void
    ontour: () => void
  } = $props()

  const DOORS = doors()
  let card: HTMLElement
  $effect(() => { card?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true }) })

  function go(e: MouseEvent, v: StartView) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return   // a new tab: let the browser
    e.preventDefault()
    onopen(v)
  }
</script>

<!-- Esc closes it (the Shell's key handler) -->
<section class="welcome" bind:this={card} aria-labelledby="welcome-t">
  <header>
    <h2 id="welcome-t" class="mbon-label">start here</h2>
    <button type="button" class="x" aria-label="Close the welcome card" onclick={onclose}>×</button>
  </header>
  <p class="lead">What were the conditions in this place, over this time? Pick a marine place and an ERDDAP
    dataset; your browser fetches the grid and computes the answer.</p>
  <div class="doors">
    {#each DOORS as d (d.label)}
      <a class="door" href={href(d)} onclick={(e) => go(e, d)}>{d.label}</a>
    {/each}
  </div>
  <span class="mbon-label">or ask</span>
  <ul>
    {#each QUESTIONS as q (q.label)}
      <li><a href={href(q)} onclick={(e) => go(e, q)}>{q.label}</a></li>
    {/each}
  </ul>
  <div class="row">
    <Button variant="quiet" size="sm" onclick={() => { onclose(); ontour() }}>Take the tour</Button>
    <Button variant="quiet" size="sm" onclick={onclose}>Just the map</Button>
  </div>
</section>

<style>
  .welcome {
    position: absolute; z-index: 45; left: 50%; top: 18%; transform: translateX(-50%);
    width: min(26rem, calc(100% - 24px)); box-sizing: border-box;
    display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--pane-bg); color: var(--text-body);
    border: 1px solid var(--pane-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl);
    font: var(--type-small);
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; }
  .x { border: 0; background: transparent; color: var(--text-muted); font-size: 1.3rem; line-height: 1; cursor: pointer; }
  .lead { margin: 0; font: var(--fw-medium) var(--text-base) / 1.35 var(--font-sans); color: var(--text-strong); }
  .doors { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-1) 0 var(--space-2); }
  .door {
    display: block; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
    background: var(--brand); color: var(--on-brand); font: var(--fw-semibold) var(--text-sm) / 1.3 var(--font-sans);
  }
  .door:hover { background: var(--brand-hover); text-decoration: none; }
  ul { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: var(--space-1); }
  .row { display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-1); }
  @media (max-width: 640px) { .welcome { top: 12px; } }
</style>
