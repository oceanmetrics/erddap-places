// the page's keyboard shortcuts (Help ▾ → Keyboard lists the same map). A shortcut never fires while
// the visitor types (input, textarea, select, contenteditable), holds Ctrl/Alt/Meta, or has focus on
// something that owns the arrow keys itself (the Controls tabs, a slider, a pane title, the map, the
// Time strip); only Esc works while a dialog or the tour is open (they handle their own keys).
import { TABS, type TabId } from './tour'

export type Shortcut =
  | { kind: 'tour' }
  | { kind: 'theme' }
  | { kind: 'lens' }
  | { kind: 'tab'; tab: TabId }
  | { kind: 'day'; by: 1 | -1 }
  | { kind: 'escape' }

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['?'], what: 'take the tour' },
  { keys: ['t'], what: 'light or dark theme' },
  { keys: ['1', '2', '3', '4'], what: 'Controls tabs: ① Place, ② Dataset & variable, ③ Method, ④ Share' },
  { keys: ['l'], what: 'switch lens: Window statistics or Then vs Now' },
  { keys: ['←', '→'], what: 'Then vs Now: the day before, the day after' },
  { keys: ['Esc'], what: 'close the open menu, dialog, card or tour; restore an expanded Time strip' },
]

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  /** the event target's tag name and whether it is editable */
  targetTag?: string
  targetEditable?: boolean
  /** the target (or an ancestor) handles arrow keys itself: a tab list, slider, pane title, map */
  targetOwnsArrows?: boolean
}

/** elements that keep their own arrow keys (checked with closest() on the event target) */
export const OWNS_ARROWS = '[role="tablist"], [role="slider"], [role="listbox"], .mbon-pane .bar, .mbon-timestrip, .maplibregl-map, .mbon-menu'

export function shortcutFor(e: KeyLike, opts: { busy?: boolean; lens?: 'stats' | 'then-now' } = {}): Shortcut | null {
  if (e.key === 'Escape') return { kind: 'escape' }
  if (opts.busy) return null
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  const tag = (e.targetTag ?? '').toUpperCase()
  if (e.targetEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null
  switch (e.key) {
    case '?':          return { kind: 'tour' }
    case 't': case 'T': return { kind: 'theme' }
    case 'l': case 'L': return { kind: 'lens' }
    case 'ArrowLeft':
    case 'ArrowRight':
      if (opts.lens !== 'then-now' || e.targetOwnsArrows) return null
      return { kind: 'day', by: e.key === 'ArrowRight' ? 1 : -1 }
  }
  const n = Number(e.key)
  if (/^[1-9]$/.test(e.key) && n <= TABS.length) return { kind: 'tab', tab: TABS[n - 1] }
  return null
}
