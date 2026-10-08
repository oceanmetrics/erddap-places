<script lang="ts">
  // a native <dialog> (focus trap, Esc and the backdrop come from the browser), dressed in the kit's
  // tokens: the Help modals and the feedback dialog. No kit component covers a modal yet.
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    title,
    width = "34rem",
    children,
    onclose,
  }: { open: boolean; title: string; width?: string; children: Snippet; onclose?: () => void } = $props();

  let el: HTMLDialogElement;
  $effect(() => {
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} class="modal" style:--w={width} aria-labelledby="modal-title"
  onclose={() => { open = false; onclose?.(); }}
  onclick={(e) => { if (e.target === el) el.close(); }}>
  {#if open}
    <div class="box">
      <header>
        <h2 id="modal-title" class="mbon-label">{title}</h2>
        <button type="button" class="x" aria-label="Close" onclick={() => el.close()}>×</button>
      </header>
      <div class="body">{@render children()}</div>
    </div>
  {/if}
</dialog>

<style>
  .modal {
    width: min(var(--w), calc(100vw - 24px));
    max-height: calc(100vh - 48px);
    padding: 0;
    border: 1px solid var(--pane-border);
    border-radius: var(--radius-md);
    background: var(--pane-bg);
    color: var(--text-body);
    box-shadow: var(--shadow-xl);
  }
  .modal::backdrop { background: rgba(0, 0, 0, 0.35); }
  .box { display: flex; flex-direction: column; max-height: calc(100vh - 50px); }
  header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4) var(--space-1); }
  h2 { margin: 0; }
  .x { border: 0; background: transparent; color: var(--text-muted); font-size: 1.4rem; line-height: 1; cursor: pointer; padding: 0 var(--space-1); }
  .x:hover { color: var(--text-strong); }
  .body { padding: var(--space-2) var(--space-4) var(--space-4); overflow: auto; font: var(--type-small); }
</style>
