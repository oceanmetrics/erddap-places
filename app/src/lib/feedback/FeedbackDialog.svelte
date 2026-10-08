<script lang="ts">
  // the feedback dialog (lazy: Shell.svelte imports it, and html-to-image with it, only when the
  // Feedback button or Help ▾ → Register a product is clicked). A note, an optional email, the captured
  // view with a minimal mark-up (rectangle, arrow, text, in one of three colours), and the ways out.
  // With an endpoint configured (endpoint.ts, docs/feedback.md) Send posts to the shared Ocean Metrics
  // Apps Script: a Sheet row, mail to the team and a GitHub issue. The email is optional, goes to the
  // Sheet and the mail only, and is never put in the issue. Without an endpoint, or when the POST
  // fails, the old routes remain: open a prefilled GitHub issue (the image goes to the clipboard to
  // paste in), copy the report, download the PNG.
  import { Button } from "@marinebon/ui";
  import Modal from "../help/Modal.svelte";
  import { drawMark, MARK_TOOLS, strokeScale, toImage, type Mark, type MarkTool } from "./annotate";
  import { DEFAULT_MARK_COLOR, MARK_COLORS } from "./colors";
  import { issueUrl, KIND_TITLE, reportBody, type FeedbackKind, type FeedbackReport } from "./issue";
  import { toBlob } from "./capture";
  import { feedbackEndpoint } from "./endpoint";
  import { buildFeedbackPayload, fitImage, isEmail } from "./payload";
  import { postFeedback } from "./postFeedback";

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
  let email = $state("");
  let website = $state(""); // the honeypot: a person never sees it
  let includeUrl = $state(true); // every view is a permalink, so on by default; still a choice
  let keep = $state(true);
  let tool = $state<MarkTool>("rect");
  let color = $state(DEFAULT_MARK_COLOR);
  let sending = $state<"idle" | "sending" | "sent" | "failed">("idle");
  let endpoint = $state<string | null>(null);
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
    sending = "idle";
  });
  // read at each opening, so a localStorage override set after the page loaded is honoured
  $effect(() => {
    if (open) endpoint = feedbackEndpoint();
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
      if (label.trim()) marks = [...marks, { tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y, text: label.trim(), color }];
      return;
    }
    cv.setPointerCapture(e.pointerId);
    draft = { tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y, color };
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

  // the GitHub issue carries the view's link only when the box is ticked
  const full = (): FeedbackReport => {
    const r = report();
    return { ...r, kind, note, url: includeUrl ? r.url : "" };
  };
  const emailOk = $derived(!email.trim() || isEmail(email));
  const canSend = $derived(!!endpoint && !!note.trim() && emailOk && sending !== "sending" && sending !== "sent");

  async function send() {
    if (!endpoint || !canSend) return;
    sending = "sending";
    status = "Sending…";
    paint();
    const r = report();
    const payload = buildFeedbackPayload({
      kind,
      text: note,
      email,
      includeUrl,
      url: r.url,
      release: r.release,
      version: r.version ?? r.appVersion,
      sha: r.sha ?? "",
      lens: r.lens,
      viewport: r.viewport,
      theme: r.theme,
      userAgent: navigator.userAgent,
      sentence: r.sentence,
      image: keep && cv ? fitImage(cv) : undefined,
      website,
    });
    const res = await postFeedback(endpoint, payload);
    if (res.ok) {
      sending = "sent";
      status = res.issueUrl ? `Sent. Thank you. It is on GitHub as ${res.issueUrl}` : "Sent. Thank you.";
    } else {
      sending = "failed";
      status = `${res.error ?? "It could not be sent"}. Nothing was lost: use Open a GitHub issue, Copy report or Download PNG instead.`;
    }
  }
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
    <label class="note">
      <span class="mbon-label">your email</span>
      <input class="txt" type="email" autocomplete="email" bind:value={email} aria-invalid={!emailOk}
        aria-describedby="fb-email-hint" placeholder="you@example.org" />
      <span id="fb-email-hint" class="hint">{emailOk ? "optional, so we can reply; not published" : "that does not look like an email address"}</span>
    </label>
    <input class="trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" bind:value={website} />

    {#if image}
      <div class="tools" role="toolbar" aria-label="mark up the screenshot">
        {#each MARK_TOOLS as t (t.id)}
          <Button variant="quiet" size="sm" pressed={tool === t.id} onclick={() => (tool = t.id)}>{t.label}</Button>
        {/each}
        {#if tool === "text"}<input class="lbl" aria-label="text to place" bind:value={label} />{/if}
        <span class="colors" role="group" aria-label="mark colour">
          {#each MARK_COLORS as c (c.id)}
            <button type="button" class="swatch" class:on={color === c.hex} aria-pressed={color === c.hex}
              aria-label={c.label} title={c.label} onclick={() => (color = c.hex)}>
              <i style:background={c.hex}></i>
            </button>
          {/each}
        </span>
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

    <label class="keep"><input type="checkbox" bind:checked={includeUrl} /> include a link to this view</label>

    <div class="row">
      {#if endpoint}
        <Button variant="primary" size="sm" disabled={!canSend} onclick={send}>{sending === "sending" ? "Sending…" : sending === "sent" ? "Sent" : "Send"}</Button>
      {/if}
      {#if !endpoint || sending === "failed"}
        <Button variant={endpoint ? "quiet" : "primary"} size="sm" onclick={openIssue}>Open a GitHub issue</Button>
      {/if}
      <Button variant="quiet" size="sm" onclick={copyReport}>Copy report</Button>
      <Button variant="quiet" size="sm" disabled={!image || !keep} onclick={download}>Download PNG</Button>
    </div>
    <p class="hint" aria-live="polite" data-send={sending}>{status || (endpoint
      ? "Send files your note and the picture with the team and as a public issue on GitHub. Your email, if you give one, goes to the team only; it is never put in the issue."
      : "Open a GitHub issue to send this: it opens prefilled with the note, the release, window size and theme (and the view's link if ticked).")}</p>
  </div>
</Modal>

<style>
  .fb { display: flex; flex-direction: column; gap: var(--space-3); }
  .note { display: flex; flex-direction: column; gap: var(--space-1); }
  textarea, .lbl {
    box-sizing: border-box; width: 100%; padding: 0.5em 0.7em; font: var(--type-small); color: var(--text-strong);
    background: var(--control-bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); resize: vertical;
  }
  .txt { box-sizing: border-box; width: 100%; padding: 0.5em 0.7em; font: var(--type-small); color: var(--text-strong);
    background: var(--control-bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
  .txt[aria-invalid="true"] { border-color: var(--danger, var(--border-strong)); }
  .trap { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .lbl { width: 9rem; }
  .colors { display: inline-flex; gap: var(--space-1); margin-inline-start: var(--space-2); }
  .swatch { display: inline-flex; align-items: center; justify-content: center; width: 1.9rem; height: 1.9rem; padding: 0;
    background: var(--control-bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
  .swatch i { display: block; width: 1rem; height: 1rem; border-radius: 50%; border: 1px solid var(--border-strong); }
  .swatch.on { outline: 2px solid var(--text-strong); outline-offset: 1px; }
  .swatch:focus-visible { outline: 2px solid var(--text-strong); outline-offset: 2px; }
  .tools { display: flex; gap: var(--space-1); flex-wrap: wrap; align-items: center; }
  .sp { flex: 1; }
  .shot { width: 100%; height: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: crosshair; touch-action: none; }
  .shot.off { opacity: 0.35; }
  .keep { display: flex; gap: var(--space-1); align-items: center; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .hint { margin: 0; color: var(--text-muted); font: var(--text-xs) / 1.4 var(--font-sans); }
</style>
