// the freeze banner (2026-10-22): erddap-places moves to Ocean Metrics Indicators. The words, the
// session dismissal and the link live here so they are tested; Shell.svelte only draws them.
// Nothing here redirects: the map is src/lib/redirect.ts and it is not activated.

/** sessionStorage key: set once the banner is closed, so it stays closed for the session */
export const FREEZE_KEY = 'om-freeze-dismissed'

export const FREEZE_TEXT = 'ERDDAP Places is frozen. Its statistics move to Ocean Metrics Indicators in build week 2 (2026-11-06 to 11-12), when this address redirects.'
export const FREEZE_LINK = 'Open this view in Indicators ↗'
/** the freeze paragraph of the About modal */
export const FREEZE_ABOUT = 'Frozen since 2026-10-22: erddap-places is moving to Ocean Metrics Indicators (https://oceanmetrics.io/indicators/); bug fixes only.'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** the session's storage, or null where it throws (private windows, blocked site data, jsdom) */
function session(): Store | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** has the banner been closed in this session? Without storage it shows (and cannot be remembered). */
export function freezeDismissed(store: Store | null = session()): boolean {
  try { return store?.getItem(FREEZE_KEY) === '1' } catch { return false }
}

/** remember the close for the session; a storage that throws only means it comes back on reload */
export function dismissFreeze(store: Store | null = session()): void {
  try { store?.setItem(FREEZE_KEY, '1') } catch { /* ignore */ }
}
