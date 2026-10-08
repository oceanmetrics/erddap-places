// POST the feedback payload to the endpoint (endpoint.ts). `text/plain` keeps it a CORS "simple
// request": an Apps Script /exec answers no OPTIONS, so an `application/json` preflight would be
// dropped. No `keepalive` either: it caps the body at 64 KiB and a screenshot exceeds that, which
// rejects at once with no request on the wire. `doFetch` is injected so tests need no network.
// Any failure (network, CORS, a non-2xx, or the script answering `{ok:false}`) resolves
// `{ ok: false }` and the dialog falls back to the GitHub issue link, so feedback is never lost
// silently.
export interface FetchResponseLike {
  ok   : boolean
  json?: () => Promise<unknown>
}
export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>

export interface SendResult {
  ok        : boolean
  /** the GitHub issue the script opened, when it did */
  issueUrl ?: string
  error    ?: string
}

export async function postFeedback(url: string, payload: unknown, doFetch: FetchLike = (u, i) => fetch(u, i)): Promise<SendResult> {
  try {
    const res = await doFetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body   : JSON.stringify(payload),
    })
    if (!res.ok) return { ok: false, error: 'the feedback server answered with an error' }
    type Reply = { ok?: boolean; error?: string; issue_url?: string }
    const read = async (): Promise<Reply | null> => { try { return res.json ? (await res.json()) as Reply : null } catch { return null } }
    const body = await read()
    if (body && body.ok === false) return { ok: false, error: body.error ?? 'the feedback server refused it' }
    return { ok: true, issueUrl: body?.issue_url || undefined }
  } catch {
    return { ok: false, error: 'the feedback server could not be reached' }
  }
}
