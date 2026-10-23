// the redirect page of a frozen Ocean Metrics app (2026-10-23): the page script, shared by erddap-places and obis-hex
// (identical copies; a checksum test in each repo, docs/redirects.md). GitHub Pages cannot answer a 301 and the
// hash never reaches a server, so the move is a small page: read `location`, ask the app's codec where the same
// view lives, show the address for 5 s with a "stay here" link, then `location.replace`.
//
//   config.json   { "app": "ERDDAP Places", "target": "Ocean Metrics Indicators", "codec": "./codec.js" }
//                 optional: "stay" (the app, relative to this page; default "../"), "delayMs" (default 5000),
//                 "home" (where to send a link the codec cannot read; default none: the page stays)
//   codec.js      an ES module exporting redirectFor(link) -> { url, exact, note? }, the app's src/lib/redirect.ts;
//                 `link` is the page's `?query#hash` without the page's own `noredirect` switch
//   ?noredirect=1 keeps the page: it shows the address and does not navigate (and the app, when its index.html
//                 forwards here, keeps itself)
//
// decide(location, config) is pure and tested; config.codec is the resolved redirectFor function there.

export const DEFAULT_DELAY_MS = 5000
export const DEFAULT_STAY = '../'

const NOREDIRECT = /(^|[?&])noredirect=1(?=&|#|$)/

/** the page's own switch removed from a query string, the rest kept byte for byte (a legacy query is unencoded) */
function stripSwitch(search) {
  const s = String(search || '').replace(/^\?/, '')
  const rest = s.split('&').filter((kv) => kv !== 'noredirect=1').join('&')
  return rest ? '?' + rest : ''
}

/**
 * What the page does for a location.
 * @param {{ search?: string, hash?: string }} loc  `location` (only `search` and `hash` are read)
 * @param {{ app?: string, target?: string, codec: (link: string) => { url: string, exact?: boolean, note?: string },
 *           stay?: string, delayMs?: number, home?: string }} config  the config.json, `codec` resolved to a function
 * @returns {{ redirect: boolean, reason: 'ok' | 'noredirect' | 'unreadable', url: string, exact: boolean, note: string,
 *             stay: string, delayMs: number, message: string }}
 *   `redirect` is true when the page navigates to `url` after `delayMs`; `reason` says why not otherwise
 */
export function decide(loc, config) {
  const search = String(loc?.search ?? ''), hash = String(loc?.hash ?? '')
  const keep = NOREDIRECT.test(search)
  const rest = stripSwitch(search)
  const target = config.target || 'its new home'
  const delayMs = Number.isFinite(config.delayMs) && config.delayMs >= 0 ? config.delayMs : DEFAULT_DELAY_MS
  // the way back: the app with its own link (query, hash) and the switch that stops it forwarding here again
  const stayBase = config.stay || DEFAULT_STAY
  const stay = stayBase + '?noredirect=1' + (rest ? '&' + rest.slice(1) : '') + hash

  let r = null
  try { r = config.codec(rest + hash) } catch { r = null }
  let url = r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url) ? r.url : ''
  let exact = !!(r && r.exact)
  let note = (r && typeof r.note === 'string' && r.note) || ''
  if (!url && config.home && /^https?:\/\//i.test(config.home)) {
    url = config.home; exact = false; note = note || 'this link could not be read; the new home is opened instead'
  }
  if (!url) {
    return { redirect: false, reason: 'unreadable', url: '', exact: false, note: '', stay, delayMs,
      message: `This app moved to ${target}, but this link could not be carried over.` }
  }
  return {
    redirect: !keep, reason: keep ? 'noredirect' : 'ok', url, exact, note, stay, delayMs,
    message: keep ? `This app moved to ${target}. The redirect is paused (?noredirect=1).`
      : `This app moved to ${target}; taking you there…`,
  }
}

// ---- the page (browser only) ----

async function main(doc, loc) {
  const here = import.meta.url
  const res = await fetch(new URL('config.json', here))
  if (!res.ok) throw new Error('config.json: ' + res.status)
  const cfg = await res.json()
  const mod = await import(/* @vite-ignore */ new URL(cfg.codec || './codec.js', here).href)
  const d = decide(loc, { ...cfg, codec: mod.redirectFor })
  const $ = (id) => doc.getElementById(id)
  doc.title = `${cfg.app || 'This app'} moved to ${cfg.target || 'its new home'}`
  $('title').textContent = `${cfg.app || 'This app'} moved`
  $('message').textContent = d.message
  $('stay').href = d.stay
  $('actions').hidden = false
  if (d.url) {
    $('target').href = d.url
    $('target').textContent = d.url
    $('link').hidden = false
  }
  if (d.note) { $('note').textContent = d.exact ? d.note : `Not an exact match: ${d.note}.`; $('note').hidden = false }
  if (!d.redirect) { $('count').textContent = ''; return }
  let left = Math.ceil(d.delayMs / 1000)
  const tick = () => { $('count').textContent = left > 0 ? `Redirecting in ${left} s, or` : 'Redirecting, or' }
  tick()
  const timer = setInterval(() => { left = Math.max(0, left - 1); tick() }, 1000)
  const go = setTimeout(() => { clearInterval(timer); loc.replace(d.url) }, d.delayMs)
  $('stay').addEventListener('click', () => { clearTimeout(go); clearInterval(timer) })
}

if (typeof document !== 'undefined') {
  main(document, location).catch(() => {
    const m = document.getElementById('message')
    if (m) m.textContent = 'This app moved, but the redirect page could not start. Stay here, or open oceanmetrics.io.'
    const a = document.getElementById('actions')
    if (a) a.hidden = false
  })
}
