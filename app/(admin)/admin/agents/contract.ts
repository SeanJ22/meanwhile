/**
 * Page-level constants for the Agent Bridge surface, kept beside the page.
 *
 * The paid-API switch is not this page's action: `config.setApiFallback` lives
 * in the console's one Action Gateway, which owns the validation, the authority
 * class, the idempotency and the receipt. This page renders the setting and
 * posts to that door — it mints no route and holds no second copy of the rule.
 */

/** The Action Gateway's POST route. One door for buttons, chat and agents alike (§3.5). */
export const GATEWAY_ACTION_ROUTE = "/api/admin/action";

/** The gateway action that records the owner's decision about paid API spending. */
export const SET_API_FALLBACK_ACTION = "config.setApiFallback";

/**
 * What the paid-API action acts on. The gateway records this as the receipt's
 * subject, so it says what was decided about rather than which button was hit.
 */
export const API_FALLBACK_SUBJECT = "paid API spending";

/**
 * What the owner may record about a review. A closed list; the decision route
 * stores the words he chose verbatim as the consequence he was shown.
 *
 * The route is `DECISION_ROUTE` from `app/(admin)/console-ui.tsx` — this page
 * uses the console's single existing write path and mints no route of its own.
 */
export const REVIEW_DECISION_OPTIONS = [
  "Go with the first reviewer",
  "Go with the second reviewer",
  "Neither — leave it as it is",
  "Ask again with a fresh snapshot",
] as const;
