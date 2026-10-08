// a `fetch` over in-memory files that answers what hyparquet's asyncBufferFromUrl asks: HEAD (the size),
// GET with a Range header (206) and a plain GET (200). `log` records every request, so a test can say what
// was (not) fetched.
export interface FileFetch { fetch: typeof fetch; log: { url: string; method: string; range: string | null; bytes: number }[] }

export function fileFetch(files: Record<string, Uint8Array | string>): FileFetch {
  const log: FileFetch['log'] = []
  const data = (u: string) => {
    const f = files[u]
    return f === undefined ? undefined : typeof f === 'string' ? new TextEncoder().encode(f) : f
  }
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? 'GET'
    const buf = data(url)
    const range = new Headers(init?.headers).get('Range')
    if (!buf) { log.push({ url, method, range, bytes: 0 }); return new Response('not found', { status: 404, statusText: 'Not Found' }) }
    if (method === 'HEAD') { log.push({ url, method, range, bytes: 0 }); return new Response(null, { status: 200, headers: { 'content-length': String(buf.byteLength) } }) }
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null
    if (m) {
      const a = Number(m[1]), b = m[2] === '' ? buf.byteLength : Math.min(buf.byteLength, Number(m[2]) + 1)
      const part = buf.slice(a, b)
      log.push({ url, method, range, bytes: part.byteLength })
      return new Response(part, { status: 206, headers: { 'content-length': String(part.byteLength), 'content-range': `bytes ${a}-${b - 1}/${buf.byteLength}` } })
    }
    log.push({ url, method, range, bytes: buf.byteLength })
    return new Response(buf.slice(), { status: 200, headers: { 'content-length': String(buf.byteLength) } })
  }) as typeof fetch
  return { fetch: f, log }
}
