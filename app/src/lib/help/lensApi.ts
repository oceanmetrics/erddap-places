// what the Shell (Help, the tour, the shortcuts, feedback) may ask of the lens on screen: each lens
// registers one of these when it mounts. The page chrome never reaches into a lens's state otherwise.
import type { TabId } from './tour'

export interface LensUi { tab: string; controls: boolean; time: boolean; side: boolean }

export interface LensApi {
  /** the Controls tab and which panes are open */
  ui(): LensUi
  /** open a tab, unfold or fold panes (the tour; the 1–4 keys) */
  setUi(u: Partial<LensUi> & { tab?: TabId | string }): void
  /** the other lens, carrying the place over (the `l` key) */
  switchLens(): void
  /** Then vs Now: the day before or after (the ← → keys) */
  day?(by: 1 | -1): void
  /** the title sentence as text (the feedback report) */
  sentence(): string
  /** the MapLibre maps on screen (the feedback picture) */
  maps(): any[]
  /** the "Cite this data" text of the view (About) */
  cite(): string
}
