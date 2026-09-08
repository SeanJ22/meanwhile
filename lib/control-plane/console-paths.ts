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

/**
 * **THE CONSOLE'S VIEWS, ONCE, IN ORDER.** (ADM-59, the 9.7.26 admin feedback.)
 *
 * ## Why this table exists rather than a seventh list
 *
 * The owner asked for one new view — Progression. Adding it the way the last
 * six were added would have meant editing six places that each describe the
 * same set: the `ConsoleView` union, `pathFor`, `VIEW_LABEL`, the `<option>`
 * list, `CONSOLE_VIEWS` here, and `SWEPT_PATHS` in the plain sweep. Only one of
 * those six is type-checked against the others.
 *
 * That is not hypothetical. Six shipped admin views — Shipping and integration,
 * Sources and APIs, What readers are doing, Feedback, Delegated work and Ask
 * the console — are in the union, in `pathFor`, in `VIEW_LABEL` and on the
 * sweep's path list, and have NO `<option>`. They have been unreachable from
 * the console header since they shipped. Nothing failed, because nothing
 * compared the lists.
 *
 * So the set is declared once, here, and everything else is derived from it.
 * `ConsoleView` comes from this table, which makes a view with no entry a
 * COMPILE error rather than a silently missing option. That closes the class
 * for view twelve, not just for view eleven (RULING 262).
 *
 * ## `path: null` is the per-state view
 *
 * State readiness lives at `/readiness/<state>`, so its path is built at
 * choose time from the state the header is holding. It is the one row whose
 * destination is not a constant, and saying so with `null` is why the lookup
 * can be total over everything else.
 */
export interface ConsoleViewRow {
  readonly view: string;
  /** What the owner reads in the dropdown. */
  readonly label: string;
  /** The fixed destination, or null for the per-state readiness view. */
  readonly path: string | null;
}

export const CONSOLE_VIEW_TABLE = [
  { view: "pilot-health", label: "Pilot health", path: "/admin" },
  { view: "readiness", label: "State readiness", path: null },
  { view: "research", label: "Research detail", path: "/admin/research" },
  { view: "release-review", label: "Software release review", path: "/admin/release-review" },
  /*
   * ADM-59. Deliberately a staging workbench, not a tracker: the owner asked
   * for "just the place right now so I can build and work through it".
   */
  { view: "progression", label: "Progression", path: "/admin/progression" },
  { view: "steward", label: "Shipping and integration", path: "/admin/steward" },
  { view: "sources", label: "Sources and APIs", path: "/admin/sources" },
  { view: "reader", label: "What readers are doing", path: "/admin/reader" },
  { view: "feedback", label: "Feedback", path: "/admin/feedback" },
  { view: "agents", label: "Delegated work", path: "/admin/agents" },
  { view: "chat", label: "Ask the console", path: "/admin/chat" },
] as const satisfies readonly ConsoleViewRow[];

/** Every view the console header can reach. Derived; never hand-kept. */
export type ConsoleView = (typeof CONSOLE_VIEW_TABLE)[number]["view"];

/**
 * The fixed console destinations, derived from the one table.
 *
 * `flatMap` rather than `filter` with a type predicate: `as const` narrows each
 * path to its own literal type, and a predicate widening those to `string`
 * is not assignable to the parameter it narrows. Dropping the nulls by
 * returning an empty array needs no predicate at all.
 */
export const CONSOLE_VIEWS: readonly string[] = CONSOLE_VIEW_TABLE.flatMap((v) =>
  v.path === null ? [] : [v.path],
);

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
