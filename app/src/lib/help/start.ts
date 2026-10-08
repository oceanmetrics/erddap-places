// first visit: the welcome card ("Start here") with two doors and three worked questions, and the
// page-URL switches that drive it. `?tour=off` suppresses the welcome card and the tour (for
// deterministic screenshots), `?tour=on` replays the tour, `?modal=about|sources|keys` opens a Help
// modal. These are query parameters, not view state: they never enter the hash, so a shared view
// link never carries them.

export const WELCOME_SEEN_KEY = 'erddap-places-welcome'

export type HelpModal = 'about' | 'sources' | 'keys'
export const HELP_MODALS: readonly HelpModal[] = ['about', 'sources', 'keys']

export interface HelpQuery {
  tour : 'on' | 'off' | null
  modal: HelpModal | null
}

export function parseHelpQuery(search: string): HelpQuery {
  const q = new URLSearchParams(search)
  const t = (q.get('tour') ?? '').toLowerCase()
  const tour = t === 'on' || t === '1' ? 'on' : t === 'off' || t === '0' ? 'off' : null
  const m = (q.get('modal') ?? '').toLowerCase()
  const modal = (HELP_MODALS as readonly string[]).includes(m) ? (m as HelpModal) : null
  return { tour, modal }
}

/** what opens on load: `?tour=off` nothing (a `?modal=` still opens); `?tour=on` the tour; a
 * `?modal=` that modal; otherwise the welcome card on a first visit only */
export function onLoad(q: HelpQuery, seen: boolean): { welcome: boolean; tour: boolean; modal: HelpModal | null } {
  if (q.tour === 'off') return { welcome: false, tour: false, modal: q.modal }
  if (q.tour === 'on')  return { welcome: false, tour: true, modal: null }
  if (q.modal)          return { welcome: false, tour: false, modal: q.modal }
  return { welcome: !seen, tour: false, modal: null }
}

/** a page URL without the help switches (`tour`, `modal`), so the view a door opens is clean */
export function withoutHelpQuery(search: string): string {
  const q = new URLSearchParams(search)
  q.delete('tour'); q.delete('modal')
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** "this day" for the Then vs Now door: today less a week (the archive runs a few days behind), as MM-DD */
export function recentMd(now: Date = new Date(), lagDays = 7): string {
  const d = new Date(now.getTime() - lagDays * 864e5)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** a view to open from the welcome card: its words and its hash */
export interface StartView { label: string; hash: string }

/** the two doors: Statistics (FKNMS × CRW SST, the dataset's last 30 days) and Then vs Now */
export function doors(now: Date = new Date()): StartView[] {
  return [
    { label: 'Sea surface temperature in a sanctuary this month',
      hash : '#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST' },
    { label: 'Then vs Now: this day against the 1985–2005 climatology',
      hash : `#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=${recentMd(now)}&then=1985-2005&now=latest` },
  ]
}

/** three worked questions, one per kind of answer the app gives */
export const QUESTIONS: StartView[] = [
  { label: 'Which seascapes make up Monterey Bay sanctuary?',
    hash : '#place=NMS:MBNMS&dataset=erddap/noaa_aoml_seascapes_8day&variable=CLASS' },
  { label: 'How has chlorophyll in Channel Islands sanctuary moved over the whole CMEMS record?',
    hash : '#place=NMS:CINMS&dataset=erddap/cmems_biogeochem_phyto&variable=chl&from=2021-10-16&to=2025-02-15' },
  { label: 'How much of the Florida Keys was more than 1 °C above normal on 5 Aug 2023?',
    hash : '#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=2023&anom=1&show=exceedance' },
]
