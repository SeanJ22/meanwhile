/**
 * **HOSTS WHOSE OWNERS REFUSED US, RECORDED ONCE.** (Moved here from the
 * discovery executor, 2026-09-24, so a research fetch can read the list
 * without reaching the executor's writers.)
 *
 * Not requested at all, robots.txt included. Robots alone would also refuse
 * these; the list keeps a recorded refusal from costing another request per
 * walk.
 *
 * PURE: data only.
 */
export const RECORDED_WALLS: readonly { readonly host: string; readonly why: string }[] = [
  { host: "go.boarddocs.com", why: "robots-disallowed and 403 to an identified client (docs/source-ladder.md, MISS list)" },
  { host: "pima.granicus.com", why: "robots.txt Disallow: / (GRANICUS_LIVE_PROCEEDINGS_WALL, lib/sources/legistar-insite/horizon.ts)" },
];
