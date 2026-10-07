<script lang="ts">
  // an Observable Plot figure sized to its slot (the TimeStrip hands over width and height). the
  // figure is rebuilt whenever `make` or the size changes; text takes the theme's colour.
  interface Props {
    make  : (width: number, height: number) => Element | null
    width : number
    height: number
  }
  let { make, width, height }: Props = $props()
  let el = $state<HTMLDivElement | null>(null)
  $effect(() => {
    if (!el || !(width > 40) || !(height > 30)) return
    const fig = make(Math.round(width), Math.round(height))
    if (!fig) { el.replaceChildren(); return }
    el.replaceChildren(fig)
    return () => fig.remove()
  })
</script>

<div class="plotbox" bind:this={el}></div>

<style>
  .plotbox { width: 100%; height: 100%; color: var(--text-body); --plot-background: var(--pane-bg); }
  .plotbox :global(svg) { display: block; background: transparent; font-family: var(--font-mono); }
  .plotbox :global(figure) { margin: 0; }
</style>
