/**
 * **WHERE A CONSOLE FORM MAY RETURN TO.** (ADM-15 and ADM-20, the 9.4.26
 * evening admin feedback.)
 *
 * Every console button is a plain form POST that ends in a 303 back to a
 * page. The destination comes from the form's `returnTo` field, and a
 * redirect target read off a request body is validated against a closed list
 * — never an arbitrary URL. The list is the console itself: the three views
 * and a state's readiness page.
 *
 * PURE, and shared by both admin routes so they cannot disagree about what
 * the console is.
 */

export const CONSOLE_VIEWS: readonly string[] = [
  "/admin",
  "/admin/changes",
  "/admin/research",
  "/admin/release-review",
  "/admin/steward",
  "/admin/sources",
  "/admin/reader",
  "/admin/feedback",
  "/admin/agents",
  "/admin/chat",
];

/** A state readiness page: `/readiness/az`. */
const READINESS_PATH = /^\/readiness\/[a-z]{2}$/;

export function isConsolePath(path: string): boolean {
  return CONSOLE_VIEWS.includes(path) || READINESS_PATH.test(path);
}

/** The validated destination, or the fallback when the field names nothing on the console. */
export function consoleReturnPath(raw: string | null | undefined, fallback: string): string {
  const path = (raw ?? "").trim();
  return isConsolePath(path) ? path : fallback;
}
