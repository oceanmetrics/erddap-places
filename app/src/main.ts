import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { isThenNowHash } from './lib/thenNow/state'

// two views, one page: the place statistics (default) and `#mode=then-now`, whose code (geotiff,
// the swipe map, the day-of-year charts) is a separate chunk loaded only when it is asked for
const target   = document.getElementById('app')!
const thenNow  = isThenNowHash(location.hash)
const app      = thenNow
  ? import('./lib/thenNow/ThenNow.svelte').then(({ default: ThenNow }) => mount(ThenNow, { target }))
  : mount(App, { target })
// switching mode by link (the hash changes, the page does not) starts the other view afresh
addEventListener('hashchange', () => { if (isThenNowHash(location.hash) !== thenNow) location.reload() })

export default app
