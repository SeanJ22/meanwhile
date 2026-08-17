/**
 * The shape of a feedback submission, shared by the server and the browser
 * (R40, 2026-08-17).
 *
 * It lives in its own module with no directive on it because BOTH halves need
 * it: the route validates against these values and the form renders the cap.
 * Reaching into `lib/db/feedback.ts` for the number would drag the database
 * module into the client bundle, which `tests/server-client-boundary.test.ts`
 * exists to catch — and a cap the client cannot see is a cap the reader hits
 * with no warning.
 */

export const FEEDBACK_MAX_CHARS = 2000;

export const FEEDBACK_SURFACES = ["SIDEBAR", "TRANSPARENCY", "COVERAGE"] as const;

export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

export function isFeedbackSurface(value: unknown): value is FeedbackSurface {
  return (
    typeof value === "string" &&
    (FEEDBACK_SURFACES as readonly string[]).includes(value)
  );
}
