/**
 * **WHERE AN OLD ADMIN LINK GOES NOW.** (rulings §0: no Admin page outside the
 * command center.) Each retired page maps to the command-center view that took
 * over its job. Pure; `middleware.ts` applies it after the session check, so a
 * signed-out request still gets the login page and never learns where a path went.
 * A `scope` the old link carried is kept.
 */
export const MOVED_ADMIN_PAGES: Readonly<Record<string, string>> = {
  "/admin/command-center": "/admin",
  "/admin/fleet": "/admin",
  "/admin/reader": "/admin",
  "/admin/research": "/admin?view=workers",
  "/admin/assignments": "/admin?view=queue",
  "/admin/expansion": "/admin?view=queue",
  "/admin/learning": "/admin?view=scoreboard",
  "/admin/fix": "/admin?view=queue",
  "/readiness/fix": "/admin?view=queue",
  "/admin/feedback": "/admin?view=reports",
  "/admin/changes": "/admin?view=changes",
  "/admin/steward": "/admin?view=changes",
  "/admin/release-review": "/admin?view=changes",
  "/admin/chat": "/admin?view=chat",
  "/admin/money": "/admin?view=money",
  "/readiness/cost": "/admin?view=money",
  "/admin/work": "/admin?view=queue",
  "/readiness/work": "/admin?view=queue",
  "/readiness": "/admin?view=checklist",
  "/readiness/done": "/admin?view=checklist",
  "/admin/sources": "/admin?view=workers",
  // The Agent Bridge page is deleted and has no view: its link lands on the command center.
  "/admin/agents": "/admin",
};

/** `/readiness/az`: a state's readiness page is the Checklist at that state. */
const READINESS_STATE = /^\/readiness\/([a-z]{2})$/;

/** The path and query to send to, or null when the path never moved. */
export function movedAdminPage(pathname: string, scope: string | null): string | null {
  const path = pathname.replace(/\/+$/, "");
  const state = READINESS_STATE.exec(path)?.[1] ?? null;
  const to = state !== null ? "/admin?view=checklist" : MOVED_ADMIN_PAGES[path];
  if (to === undefined) return null;
  if (state !== null && (scope === null || scope === "")) return `${to}&scope=${state}`;
  if (scope === null || scope === "") return to;
  return `${to}${to.includes("?") ? "&" : "?"}scope=${encodeURIComponent(scope)}`;
}
