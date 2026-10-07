"use client";

import { feedbackContext, type FeedbackContext, type FeedbackSurface } from "./shape.ts";
import { getOrCreateBrowserKey } from "../state/browser-key.ts";

/**
 * The browser half of the feedback form. `wtp.feedback_key` is a random
 * string minted on the browser's first submission, used only for rate
 * limiting; the feedback row has no key column.
 */

const KEY_STORAGE = "wtp.feedback_key";



export function getOrCreateFeedbackKey(): string {
  // The storage key keeps this store apart from the others; see lib/state/browser-key.ts.
  return getOrCreateBrowserKey(KEY_STORAGE);
}

export type SubmitOutcome =
  | { kind: "STORED" }
  /** Everything else. `message` is what the reader is shown, verbatim. */
  | { kind: "NOT_STORED"; message: string };

/** What a reader sees when the network never answered at all. */
const UNREACHABLE =
  "We could not reach the server, so nothing was kept. Your message is still in the box — try again.";

/**
 * Submit, and report what actually happened. Only a 204 is STORED; everything
 * else is NOT_STORED with a sentence the reader can act on.
 */
export async function submitFeedback(
  message: string,
  surface: FeedbackSurface,
  /** The optional reply address. Blank is sent as "", so the server sees one shape. */
  replyTo = "",
  context: FeedbackContext = {},
): Promise<SubmitOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        surface,
        replyTo,
        feedbackKey: getOrCreateFeedbackKey(),
        ...feedbackContext(context),
      }),
    });
  } catch {
    return { kind: "NOT_STORED", message: UNREACHABLE };
  }

  if (response.status === 204) return { kind: "STORED" };

  // The server's own sentence where it sent one.
  let served: string | null = null;
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      served = payload.error.trim();
    }
  } catch {
    served = null;
  }
  return {
    kind: "NOT_STORED",
    message: served ?? "We could not save that. Nothing was kept.",
  };
}
