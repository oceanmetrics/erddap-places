// the in-app tour: a focus ring on one part of the page and a small card (Back / Next / Done), after
// calcofi.io/explore's "Help, the tour and feedback" and obis-hex's tour. The stops follow the page in
// pipeline order: the sentence, ① Place, ② Dataset & variable, ③ Method (with the lens switch), the
// legend line, the Time strip (its Plot tab, then its Table tab and download menu; in Then vs Now the
// right-edge exceedance pill), ④ Share, then Help. No library: Tour.svelte draws
// the ring and the card; this file holds the stops and the keyboard rules, so both are tested.

/** the Controls tabs, in order (the same ids in both lenses) */
export type TabId = 'place' | 'data' | 'method' | 'share'
export const TABS: readonly TabId[] = ['place', 'data', 'method', 'share'] as const

export interface TourStop {
  id: string
  /** CSS selectors for the part to ring, tried in order; the first visible one wins */
  target: string[]
  title: string
  text: string
  /** open this Controls tab (and unfold Controls) before ringing it */
  tab?: TabId
  /** unfold the Time strip first */
  time?: boolean
  /** show this tab of the Time strip (Statistics; Then vs Now has no tabs and ignores it) */
  timeTab?: 'plot' | 'table'
}

const tabSel = (t: TabId) => [`.mbon-controls [role="tab"][id$="-tab-${t}"]`, `[role="tab"][id$="-tab-${t}"]`]

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'sentence',
    target: ['.sentence-bar .mbon-sentence .line', '.sentence-bar'],
    title: 'What the map shows',
    text: 'This sentence says what is on the map: the variable, the place, the method and the time. Click any bold word to change it.',
  },
  {
    id: 'place',
    target: tabSel('place'),
    tab: 'place',
    title: '① Place',
    text: 'Pick any polygon place of the Ocean Metrics gazetteer (sanctuaries, monuments, reserves, protected areas, wind leases and more), search all 14,000 by name, or click one on the map. The 20 marked precomputed load at once; any other fetches its boundary when it runs.',
  },
  {
    id: 'data',
    target: tabSel('data'),
    tab: 'data',
    title: '② Dataset & variable',
    text: 'Pick an ERDDAP dataset and one of its variables. Each request goes straight to that ERDDAP server.',
  },
  {
    id: 'method',
    target: tabSel('method'),
    tab: 'method',
    title: '③ Method',
    text: 'Window statistics summarise the place day by day; Then vs Now sets one day of the year against a climatology. The switch at the top changes lens; the rest sets the statistic, the window or the day.',
  },
  {
    id: 'legend',
    target: ['.sentence-bar .mbon-sentence .sub', '.sentence-bar'],
    title: 'The colour scale and the counts',
    text: 'The second line is the map’s colour scale and what it covers: the day mapped and the grid cells inside the place, or the anomaly headline in Then vs Now.',
  },
  {
    id: 'time',
    target: ['.mbon-timestrip'],
    time: true,
    timeTab: 'plot',
    title: 'The Time strip',
    text: 'The series behind the map. Drag across it to choose a new window (or, in Then vs Now, a day); it runs on its own. The corner button expands the strip over the map (Esc restores it).',
  },
  {
    id: 'table',
    // Statistics: the strip's Table tab; Then vs Now has no tabs, so its exceedance pill is rung instead
    target: ['.mbon-timestrip [role="tab"][id$="-tab-table"]', '.mbon-pane-pill[aria-label="Show exceedance pane"]', '.mbon-pane.edge-pane .bar'],
    time: true,
    timeTab: 'table',
    title: 'The table and the download',
    text: 'Statistics: the Table tab of the Time strip lists every day (or class, or month), and the ⬇ menu beside it downloads the table as CSV or Parquet, or the plot as a PNG. Then vs Now: the pill on the right edge opens the exceedance, how much of the place is more than 1 °C warmer.',
  },
  {
    id: 'share',
    target: tabSel('share'),
    tab: 'share',
    title: '④ Share',
    text: 'Download the table or a PNG, copy the link (every view is one) and cite the data. Reproduce lists the exact requests and SQL.',
  },
  {
    id: 'help',
    target: ['.mbon-header .mbon-menu .trigger'],
    title: 'Help',
    text: 'This tour, the guide, the data sources and the keyboard shortcuts live here. Feedback, beside it, sends us a picture of what you see.',
  },
]

/** what a key does while the tour is open: move, close, or nothing (let the page have it) */
export type TourMove = 'next' | 'back' | 'first' | 'last' | 'close' | null

export function tourKey(key: string): TourMove {
  switch (key) {
    case 'ArrowRight': case 'PageDown': return 'next'
    case 'ArrowLeft':  case 'PageUp':   return 'back'
    case 'Home':   return 'first'
    case 'End':    return 'last'
    case 'Escape': return 'close'
    default:       return null
  }
}

/** the stop after a move; -1 closes the tour (Next on the last stop is Done) */
export function tourStep(i: number, move: TourMove, n: number = TOUR_STOPS.length): number {
  if (n <= 0) return -1
  switch (move) {
    case 'next':  return i + 1 >= n ? -1 : i + 1
    case 'back':  return Math.max(0, i - 1)
    case 'first': return 0
    case 'last':  return n - 1
    case 'close': return -1
    default:      return i
  }
}

export interface Rect { left: number; top: number; width: number; height: number }

/** where the card goes: below the ringed part if it fits, else above, else beside; always inside the
 * window (8 px margin) */
export function cardPosition(target: Rect, card: { width: number; height: number }, win: { width: number; height: number }, gap = 12): { left: number; top: number } {
  const m = 8
  const clampX = (x: number) => Math.max(m, Math.min(x, win.width - card.width - m))
  const clampY = (y: number) => Math.max(m, Math.min(y, win.height - card.height - m))
  const below = target.top + target.height + gap
  if (below + card.height <= win.height - m) return { left: clampX(target.left), top: below }
  const above = target.top - gap - card.height
  if (above >= m) return { left: clampX(target.left), top: above }
  const right = target.left + target.width + gap
  if (right + card.width <= win.width - m) return { left: right, top: clampY(target.top) }
  return { left: clampX(target.left - gap - card.width), top: clampY(target.top) }
}
