// Where the feedback dialog POSTs: the shared Ocean Metrics Apps Script (docs/feedback.md). In order:
//   1. build time: VITE_FEEDBACK_URL (the repo variable of the same name, passed in pages.yml);
//   2. a localStorage override, `erddap-places.feedback_url`, to test another deployment or a fixture
//      without a rebuild.
// Each leg must look like http(s)://…; an unset GitHub variable arrives as the empty string, and a
// junk value must mean "no endpoint" (the dialog then falls back to the GitHub issue link), never a
// broken fetch target blamed on the network.
export const FEEDBACK_URL_KEY = 'erddap-places.feedback_url'
const URL_RE = /^https?:\/\//

export function feedbackEndpoint(): string | null {
  const env = (import.meta.env.VITE_FEEDBACK_URL as string | undefined)?.trim()
  if (env && URL_RE.test(env)) return env
  try {
    const stored = localStorage.getItem(FEEDBACK_URL_KEY)?.trim()
    if (stored && URL_RE.test(stored)) return stored
  } catch { /* private mode or storage blocked: no override, not an error */ }
  return null
}
