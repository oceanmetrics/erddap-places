<script lang="ts">
  // the tour: a ring around one part of the page and a card beside it (Back / Next / Done). No
  // library. Keys while open: ← → (PageUp/PageDown) move, Home/End jump, Esc closes; focus sits on
  // the card's Next button and returns where it was when the tour closes. Movement is animated only
  // when the visitor has not asked for reduced motion.
  import { onMount } from "svelte";
  import { Button } from "@marinebon/ui";
  import { cardPosition, tourKey, tourStep, TOUR_STOPS, type Rect, type TourStop } from "./tour";

  let {
    index = $bindable(-1),
    onstep,
    onclose,
  }: { index: number; onstep: (s: TourStop) => void; onclose?: () => void } = $props();

  const stop = $derived(index >= 0 && index < TOUR_STOPS.length ? TOUR_STOPS[index] : null);
  const last = $derived(index === TOUR_STOPS.length - 1);
  let ring = $state<Rect | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);
  let card = $state<HTMLElement>();
  let back: Element | null = null;

  function target(s: TourStop): HTMLElement | null {
    for (const sel of s.target)
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    return null;
  }

  function place() {
    if (!stop || !card) return;
    const el = target(stop);
    const pad = 4;
    const win = { width: innerWidth, height: innerHeight };
    const c = card.getBoundingClientRect();
    if (!el) {
      ring = null;
      pos = { left: (win.width - c.width) / 2, top: (win.height - c.height) / 2 };
      return;
    }
    const r = el.getBoundingClientRect();
    ring = { left: r.left - pad, top: r.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
    pos = cardPosition(ring, { width: c.width, height: c.height }, win);
  }

  function go(i: number) {
    if (i < 0) {
      index = -1;
      return;
    }
    index = i;
  }

  // each stop: let the app open what it needs (a tab, the Time strip), then ring it once laid out
  $effect(() => {
    const s = stop;
    if (!s) return;
    onstep(s);
    const t1 = setTimeout(() => {
      place();
      card?.querySelector<HTMLButtonElement>(".tour-next")?.focus({ preventScroll: true });
    }, 50);
    const t2 = setTimeout(place, 400);
    // the page keeps moving under a stop (the sentence wraps once the data are in, a pane unfolds):
    // follow it
    const t3 = setInterval(place, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(t3);
    };
  });

  // open / close: remember and restore focus
  let wasOpen = false;
  $effect(() => {
    const open = index >= 0;
    if (open && !wasOpen) back = document.activeElement;
    if (!open && wasOpen) {
      ring = null;
      pos = null;
      (back as HTMLElement | null)?.focus?.({ preventScroll: true });
      onclose?.();
    }
    wasOpen = open;
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (index < 0) return;
      const move = tourKey(e.key);
      if (!move) return;
      // arrows inside a text field belong to the field
      const t = e.target as HTMLElement | null;
      if (move !== "close" && t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      e.stopPropagation();
      go(tourStep(index, move));
    };
    const onResize = () => place();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  });
</script>

{#if stop}
  {#if ring}
    <div class="tour-ring" aria-hidden="true" style:left="{ring.left}px" style:top="{ring.top}px"
      style:width="{ring.width}px" style:height="{ring.height}px"></div>
  {/if}
  <div class="tour-card" bind:this={card} role="dialog" aria-modal="false" aria-labelledby="tour-t" aria-describedby="tour-d"
    style:left="{pos?.left ?? -9999}px" style:top="{pos?.top ?? 0}px">
    <div class="head">
      <h2 id="tour-t">{stop.title}</h2>
      <span class="n mbon-label">{index + 1} / {TOUR_STOPS.length}</span>
    </div>
    <p id="tour-d" aria-live="polite">{stop.text}</p>
    <div class="row">
      <Button variant="quiet" size="sm" onclick={() => go(-1)}>Skip</Button>
      <span class="sp"></span>
      <Button variant="quiet" size="sm" disabled={index === 0} onclick={() => go(tourStep(index, "back"))}>Back</Button>
      <Button variant="primary" size="sm" class="tour-next" onclick={() => go(tourStep(index, "next"))}>{last ? "Done" : "Next"}</Button>
    </div>
  </div>
{/if}

<style>
  .tour-ring {
    position: fixed; z-index: 900; pointer-events: none; border-radius: var(--radius-sm);
    outline: 3px solid var(--accent); outline-offset: 0;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.28);
  }
  .tour-card {
    position: fixed; z-index: 901; width: min(20rem, calc(100vw - 16px)); box-sizing: border-box;
    padding: var(--space-3) var(--space-4); background: var(--pane-bg); color: var(--text-body);
    border: 1px solid var(--pane-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl);
    font: var(--type-small);
  }
  @media (prefers-reduced-motion: no-preference) {
    .tour-ring, .tour-card { transition: left var(--dur-base) var(--ease-out), top var(--dur-base) var(--ease-out), width var(--dur-base) var(--ease-out), height var(--dur-base) var(--ease-out); }
  }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
  h2 { margin: 0; font: var(--fw-semibold) var(--text-base) / 1.3 var(--font-sans); color: var(--text-strong); }
  p { margin: var(--space-2) 0 var(--space-3); line-height: 1.45; }
  .row { display: flex; gap: var(--space-2); align-items: center; }
  .sp { flex: 1; }
</style>
