/**
 * The shape of a feedback submission, shared by the server and the browser.
 * Kept free of database imports so the client bundle can read the caps.
 */

export const FEEDBACK_MAX_CHARS = 2000;

/** The optional reply address cap, well under any real address, so it cannot carry a second message. */
export const REPLY_TO_MAX_CHARS = 254;

/**
 * Is this shaped like an address we could reply to: one `@` with something
 * either side and no whitespace. No claim that it exists or is deliverable.
 * Blank is valid.
 */
export function isReplyToShaped(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > REPLY_TO_MAX_CHARS) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}

export const FEEDBACK_SURFACES = ["SIDEBAR", "TRANSPARENCY", "COVERAGE"] as const;

export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

/** The reported card and place, never a reader or a browsing history. */
export interface FeedbackContext {
  about?: string | null;
  zip?: string | null;
  recordId?: string | null;
}

export function feedbackContext(input: FeedbackContext): FeedbackContext {
  return {
    about: input.about?.trim().slice(0, 80) || null,
    zip: input.zip && /^\d{5}$/.test(input.zip) ? input.zip : null,
    recordId: input.recordId?.trim().slice(0, 200) || null,
  };
}

export function feedbackHref(input: FeedbackContext): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(feedbackContext(input))) {
    if (value) params.set(key, value);
  }
  return `/feedback${params.size ? `?${params}` : ""}`;
}

export function isFeedbackSurface(value: unknown): value is FeedbackSurface {
  return (
    typeof value === "string" &&
    (FEEDBACK_SURFACES as readonly string[]).includes(value)
  );
}
