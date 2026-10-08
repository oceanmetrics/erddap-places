import { mount } from 'svelte'
import '@marinebon/ui/styles.css'
import './app.css'
import { initTheme } from '@marinebon/ui'
import Shell from './Shell.svelte'

// one page, two lenses (place statistics, Then vs Now); the Shell switches between them without a
// reload and keeps the Then vs Now code (geotiff, the swipe map) in a chunk loaded only when asked for
initTheme()
const app = mount(Shell, { target: document.getElementById('app')! })

export default app
