// the swipe between Then (left) and Now (right): two MapLibre maps stacked in one box, the Now map
// clipped with `clip-path: inset(0 0 0 Xpx)` and their cameras kept in step. this is what
// @maplibre/maplibre-gl-compare does, minus its CommonJS `require('events')` and its `window.maplibregl`
// global, neither of which survives a Vite ES build without polyfills.
import type { Map as MlMap } from 'maplibre-gl'

/** the CSS clip for the right-hand (Now) map at a swipe fraction 0..1 of the box width. */
export function clipFor(fraction: number, width: number): string {
  const x = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return `inset(0 0 0 ${x}px)`
}

/** keep two maps' cameras identical; returns the unsubscribe. */
export function syncMaps(a: MlMap, b: MlMap): () => void {
  let busy = false
  const follow = (from: MlMap, to: MlMap) => () => {
    if (busy) return
    busy = true
    to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() })
    busy = false
  }
  const fa = follow(a, b), fb = follow(b, a)
  a.on('move', fa); b.on('move', fb)
  return () => { a.off('move', fa); b.off('move', fb) }
}
