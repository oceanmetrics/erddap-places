<script lang="ts">
  // the feedback dialog (lazy: Shell.svelte imports it, and html-to-image with it, only when the
  // Feedback button or Help ▾ → Register a product is clicked). A note, the captured view with a minimal
  // mark-up (rectangle, arrow, text), and three ways out, none through a server of ours: open a
  // prefilled GitHub issue (the image goes to the clipboard to paste in), copy the report, download
  // the PNG. No email address is asked for.
  import { Button } from "@marinebon/ui";
  import Modal from "../help/Modal.svelte";
  import { drawMark, MARK_TOOLS, strokeScale, toImage, type Mark, type MarkTool } from "./annotate";
  import { issueUrl, KIND_TITLE, reportBody, type FeedbackKind, type FeedbackReport } from "./issue";
  import { toBlob } from "./capture";

  let {
    open = $bindable(false),
    kind,
    image,
    report,
    filename = "erddap-places_feedback.png",
  }: {
    open: boolean;
    kind: FeedbackKind;
    image: HTMLCanvasElement | null;
    report: () => Omit<FeedbackReport, "note" | "kind">;
    filename?: string;
  } = $props();

  let note = $state("");
  let keep = $state(true);
  let tool = $state<MarkTool>("rect");
  let label = $state("this");
  let marks = $state<Mark[]>([]);
  let draft = $state<Mark | null>(null);
  let status = $state("");
  let cv = $state<HTMLCanvasElement>();

  function paint() {
    if (!cv || !image) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(image, 0, 0);
    const k = strokeScale(cv.width);
    for (const m of marks) drawMark(ctx, m, k);
    if (draft) drawMark(ctx, draft, k);
  }
  $effect(() => {
    if (!cv || !image) return;
    cv.width = image.width;
    cv.height = image.height;
  });
  // a new picture (the dialog is opened again) starts without the last one's marks
  $effect(() => {
    void image;
    marks = [];
    draft = null;
    status = "";
  });
  $effect(() => {
    void marks.length;
    void draft;
    paint();
  });

  function pt(e: PointerEvent) {
    const r = cv!.getBoundingClientRect();
    return toImage(e.clientX, e.clientY, r, cv!.width, cv!.height);
  }
  function down(e: PointerEvent) {
    if (!cv) return;
    const p = pt(e);
    if (tool === "text") {
      if (label.trim()) marks = [...marks, { tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y, text: label.trim() }];
      return;
    }
    cv.setPointerCapture(e.pointerId);
    draft = { tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }
  function move(e: PointerEvent) {
    if (!draft) return;
    const p = pt(e);
    draft = { ...draft, x1: p.x, y1: p.y };
  }
  function up() {
    if (draft && Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) > 4) marks = [...marks, draft];
    draft = null;
  }

  const full = (): FeedbackReport => ({ ...report(), kind, note });
  async function pngBlob(): Promise<Blob | null> {
    if (!keep || !cv) return null;
    paint();
    return toBlob(cv);
  }
  async function clip(text: string | null, png: Blob | null): Promise<boolean> {
    try {
      const parts: Record<string, Blob> = {};
      if (text !== null) parts["text/plain"] = new Blob([text], { type: "text/plain" });
      if (png) parts["image/png"] = png;
      if (!Object.keys(parts).length) return false;
      await navigator.clipboard.write([new ClipboardItem(parts)]);
      return true;
    } catch {
      if (text !== null) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  async function openIssue() {
    const r = full();
    const png = await pngBlob();
    const ok = png ? await clip(null, png) : false;
    window.open(issueUrl(r), "_blank", "noopener");
    status = png
      ? ok
        ? "The issue opened in a new tab. The screenshot is on your clipboard: paste it into the issue."
        : "The issue opened in a new tab. The screenshot could not be copied: use Download PNG and drag it into the issue."
      : "The issue opened in a new tab.";
  }
  async function copyReport() {
    const png = await pngBlob();
    const ok = await clip(reportBody(full(), { paste: false }), png);
    status = ok ? `Copied the report${png ? " and the screenshot" : ""}.` : "Copied the text (the browser would not copy the image; use Download PNG).";
  }
  async function download() {
    const png = await pngBlob();
    if (!png) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status = "Downloaded.";
  }
</script>

<Modal bind:open title={kind === "product" ? KIND_TITLE.product : "send feedback"} width="46rem">
  <div class="fb">
    <label class="note">
      <span class="mbon-label">{kind === "product" ? "what did you build? a link helps" : "your note"}</span>
      <textarea rows="3" bind:value={note}
        placeholder={kind === "product" ? "A paper, a report, a dashboard, a class…" : "What looks wrong, or what would help?"}></textarea>
    </label>

    {#if image}
      <div class="tools" role="toolbar" aria-label="mark up the screenshot">
        {#each MARK_TOOLS as t (t.id)}
          <Button variant="quiet" size="sm" pressed={tool === t.id} onclick={() => (tool = t.id)}>{t.label}</Button>
        {/each}
        {#if tool === "text"}<input class="lbl" aria-label="text to place" bind:value={label} />{/if}
        <span class="sp"></span>
        <Button variant="quiet" size="sm" disabled={!marks.length} onclick={() => (marks = marks.slice(0, -1))}>Undo</Button>
        <Button variant="quiet" size="sm" disabled={!marks.length} onclick={() => (marks = [])}>Clear</Button>
      </div>
      <canvas bind:this={cv} class="shot" class:off={!keep} aria-label="the current view; drag to mark it up"
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
      <label class="keep"><input type="checkbox" bind:checked={keep} /> include the screenshot</label>
    {:else}
      <p class="hint">The view could not be captured; the report still carries its link.</p>
    {/if}

    <div class="row">
      <Button variant="primary" size="sm" onclick={openIssue}>Open a GitHub issue</Button>
      <Button variant="quiet" size="sm" onclick={copyReport}>Copy report</Button>
      <Button variant="quiet" size="sm" disabled={!image || !keep} onclick={download}>Download PNG</Button>
    </div>
    <p class="hint" aria-live="polite">{status || "Nothing is sent from this page. The issue opens on GitHub with the view's link, release, window size and theme; we never see an email address."}</p>
  </div>
</Modal>

<style>
  .fb { display: flex; flex-direction: column; gap: var(--space-3); }
  .note { display: flex; flex-direction: column; gap: var(--space-1); }
  textarea, .lbl {
    box-sizing: border-box; width: 100%; padding: 0.5em 0.7em; font: var(--type-small); color: var(--text-strong);
    background: var(--control-bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); resize: vertical;
  }
  .lbl { width: 9rem; }
  .tools { display: flex; gap: var(--space-1); flex-wrap: wrap; align-items: center; }
  .sp { flex: 1; }
  .shot { width: 100%; height: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: crosshair; touch-action: none; }
  .shot.off { opacity: 0.35; }
  .keep { display: flex; gap: var(--space-1); align-items: center; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .hint { margin: 0; color: var(--text-muted); font: var(--text-xs) / 1.4 var(--font-sans); }
</style>
