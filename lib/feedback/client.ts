"use client";

import type { FeedbackSurface } from "./shape.ts";
import { getOrCreateBrowserKey } from "../state/browser-key.ts";

/**
 * The browser half of the feedback form (R40, 2026-08-17).
 *
 * One localStorage key, `wtp.feedback_key`: a random string minted on the
 * browser's FIRST submission — never at page load, so a reader who never
 * writes never gets one. It is sent with the submission and used for one
 * thing, rate limiting; the feedback row itself has no key column, and the
 * only persisted trace is a counter digest that expires on the limiter's own
 * 48-hour schedule. Disclosed on /transparency.
 *
 * Storage unavailable (private mode, blocked) falls back to memory: the form
 * still works, the counter just starts fresh next tab.
 */

const KEY_STORAGE = "wtp.feedback_key";



export function getOrCreateFeedbackKey(): string {
  // NH79: one audited implementation. The STORAGE KEY is what keeps this
  // store apart from the other one — see lib/state/browser-key.ts, which
  // carries why the in-memory fallback must not be shared.
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
 * Submit, and report what actually happened.
 *
 * Every non-204 becomes NOT_STORED with a sentence the reader can act on.
 * There is no branch that returns STORED without a 204, which is the render-
 * default rule applied to a write: a form that thanks you for something it
 * did not keep is the same defect as a card asserting a vote nobody cast.
 */
export async function submitFeedback(
  message: string,
  surface: FeedbackSurface,
  /**
   * The OPTIONAL reply address (R41). Blank is the ordinary case and is sent
   * as an empty string rather than omitted, so the server sees the same shape
   * whether the reader filled the field or left it alone.
   */
  replyTo = "",
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
      }),
    });
  } catch {
    return { kind: "NOT_STORED", message: UNREACHABLE };
  }

  if (response.status === 204) return { kind: "STORED" };

  // The server's own sentence where it sent one — it knows which failure it
  // was, and a generic client message would flatten five states into one.
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
