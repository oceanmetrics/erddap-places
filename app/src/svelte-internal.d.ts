// maskPerf.test.ts reaches into svelte's runtime for `proxy()` (to reproduce a $state-wrapped place
// outside a component); the package ships no types for that internal entry point
declare module 'svelte/internal/client'
