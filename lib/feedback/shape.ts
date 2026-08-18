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

/**
 * The optional reply address (R41, 2026-08-17, the author's ruling A).
 *
 * Capped well under any real address so the field cannot be used as a second
 * message body — a 2000-character "address" would be free text sneaking past
 * the T09 scrub that the message half still passes through.
 */
export const REPLY_TO_MAX_CHARS = 254;

/**
 * Is this shaped like an address we could actually reply to?
 *
 * DELIBERATELY SHALLOW. It checks that there is one `@` with something either
 * side and no whitespace — enough to catch a reader who typed a sentence into
 * the wrong box, and nothing more. It makes NO claim that the address exists
 * or is deliverable, and nothing anywhere renders it as though it did: a
 * validator that implies "we checked" is the render-default rule broken at
 * the point of collection.
 *
 * Blank is valid, because the field is optional and blank is its default.
 */
export function isReplyToShaped(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > REPLY_TO_MAX_CHARS) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}

export const FEEDBACK_SURFACES = ["SIDEBAR", "TRANSPARENCY", "COVERAGE"] as const;

export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

export function isFeedbackSurface(value: unknown): value is FeedbackSurface {
  return (
    typeof value === "string" &&
    (FEEDBACK_SURFACES as readonly string[]).includes(value)
  );
}
