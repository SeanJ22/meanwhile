/**
 * **A WALK OF THE LIVE SITE READS AND NEVER WRITES** (FE-01).
 *
 * The harnesses used to refuse any non-local target (RULING 125) because every
 * visit wrote rows into stores we sell. Current rulings (§6) require looking at
 * the live page, and the runner already marks its browsing as synthetic. This
 * is the other half: the routes that record what a visitor did or asked are
 * aborted in the browser, so a walk against production leaves no search-log,
 * event, reaction, feedback, Ask or Send row behind.
 *
 * Pure over (url, method) so a unit test can walk it without a browser.
 */

/** Our write routes. Matched on the path, whatever the method. */
export const LIVE_WRITE_PATHS: readonly string[] = [
  "/api/log",
  "/api/events",
  "/api/reactions",
  "/api/feedback",
  "/api/ask",
  "/api/speak",
];

/** True when this request would record something on the live site. */
export function isLiveWriteRequest(requestUrl: string, method: string): boolean {
  let path: string;
  try {
    path = new URL(requestUrl).pathname;
  } catch {
    return false;
  }
  const verb = method.toUpperCase();
  if (verb === "OPTIONS") return false;
  const onWritePath = LIVE_WRITE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (!onWritePath) return false;
  /* A plain read of a write route's own path (a GET with no body) writes
   * nothing, except /api/ask, which answers a GET by asking. */
  if (verb === "GET" || verb === "HEAD") return path === "/api/ask" || path.startsWith("/api/ask/");
  return true;
}

/** Whether a base URL is the machine running the walk. */
export function isLocalBase(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}
