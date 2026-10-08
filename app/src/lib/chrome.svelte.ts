// the page chrome the lenses write into: the one footer line (data release, timings, the quiet
// "updating…" state) and the current theme, which the maps read to switch their basemap.
import { currentTheme, onThemeChange } from '@marinebon/ui'

export const chrome = $state({
  /** the data release line, e.g. "ERDDAP 2.29 · PacIOOS · data through 6 Oct 2026" */
  release: '',
  /** timings and bytes of the view on screen, e.g. "30 rows · 159 kB · 2.9 s" */
  timing : '',
  /** true while a view is being computed: the footer says "updating…" */
  busy   : false,
  /** what is being done right now, shown after "updating…" */
  step   : '',
})

/** the theme the page is in (`data-theme` on <html>), kept current. */
export const theme = $state({ dark: false })
if (typeof document !== 'undefined') {
  try { theme.dark = currentTheme() === 'dark' } catch { /* jsdom without matchMedia */ }
  try { onThemeChange((t) => { theme.dark = t === 'dark' }) } catch { /* idem */ }
}
