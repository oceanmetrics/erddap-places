// one run of the pipeline at a time, with the newest always winning.
//
// the pipeline awaits ERDDAP axes, a griddap slab and DuckDB in turn, so a run started while another
// is in flight used to interleave: an SST result rendered through the newly-picked categorical
// variable ("class NaN" rows, the wrong dates). every run takes a token here; every await checkpoint
// asks `stale()` before touching the UI, and the superseded run's fetches are aborted.

export interface RunHandle {
  token : number
  signal: AbortSignal
  /** true once a newer run has started (or everything was aborted). */
  stale : () => boolean
}

export class Runs {
  #n = 0
  #ctrl: AbortController | null = null

  /** the newest token handed out. */
  get current(): number { return this.#n }
  /** is a run still in flight? */
  get active(): boolean { return this.#ctrl !== null && !this.#ctrl.signal.aborted }

  /** start a run, superseding (and aborting) any run in flight. */
  start(): RunHandle {
    this.#ctrl?.abort(new DOMException('superseded by a newer run', 'AbortError'))
    const ctrl  = new AbortController()
    const token = ++this.#n
    this.#ctrl  = ctrl
    return { token, signal: ctrl.signal, stale: () => token !== this.#n }
  }

  /** a run reports it is over; a superseded one leaves the newer run's controller alone. */
  finish(h: RunHandle): void { if (h.token === this.#n) this.#ctrl = null }

  /** abort whatever is in flight and make every outstanding handle stale. */
  abort(): void {
    this.#ctrl?.abort(new DOMException('aborted', 'AbortError'))
    this.#ctrl = null
    this.#n++
  }
}

/** an AbortError from a superseded run is not a failure to report. */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))
}
