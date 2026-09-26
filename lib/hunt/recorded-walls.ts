/**
 * **HOSTS THAT WALL THIS CLIENT BY AN ACCESS CONTROL, RECORDED ONCE.** (Moved
 * here from the discovery executor, 2026-09-24, so a research fetch can read
 * the list without reaching the executor's writers.)
 *
 * Not requested at all, robots.txt included: the list keeps a recorded wall
 * from costing another request per walk. Since the owner decision of
 * 2026-09-25 (robots.txt alone must not block acquisition) a host is listed
 * here only for a real access control on its pages — a 401/403, a bot
 * challenge, a login — and never for a robots.txt line. `pima.granicus.com`
 * was listed for `Disallow: /` alone and left the list that day.
 *
 * PURE: data only.
 */
export const RECORDED_WALLS: readonly { readonly host: string; readonly why: string }[] = [
  {
    host: "go.boarddocs.com",
    why: "HTTP 403 to an identified client (docs/source-ladder.md, MISS list); an access control, investigated by other public routes and never defeated",
  },
];
