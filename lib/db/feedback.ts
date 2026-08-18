import {
  FEEDBACK_MAX_CHARS,
  REPLY_TO_MAX_CHARS,
  isReplyToShaped,
  type FeedbackSurface,
} from "../feedback/shape.ts";
import { scrubFreeText } from "../log/scrub.ts";

import { getDb } from "./index.ts";
import { ORGANIC, type RunMarker } from "./run-marker.ts";
import { feedback } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/**
 * The single write path for reader feedback (R40, 2026-08-17).
 *
 * One path, so the scrub cannot be skipped by a second caller — the same
 * argument that put the search log's scrub here rather than in its route.
 *
 * ## What it returns, and why it is not a boolean
 *
 * The row's own spec: **a submission never silently succeeds into a void.**
 * That is the render-default rule applied to a write, and a boolean cannot
 * carry it — `false` would have to mean both "there is no database, which is
 * an ordinary state for the demo" and "the insert failed", and the reader
 * deserves to be told the difference. So the result is a named outcome, and
 * every caller has to handle each one.
 */

export type { FeedbackSurface };

export type FeedbackWriteResult =
  /** It is in the store. The only outcome a reader may be thanked for. */
  | { kind: "STORED" }
  /**
   * No database configured. Real, and honest to say so — but it is NOT a
   * success, and a caller that renders it as one has told the reader their
   * words were kept when nothing was kept.
   */
  | { kind: "NO_STORE" }
  /** The insert was attempted and failed. Told plainly, never swallowed. */
  | { kind: "FAILED"; reason: string };

export interface FeedbackSubmission {
  message: string;
  surface: FeedbackSurface;
  /**
   * The OPTIONAL reply address (R41, 2026-08-17, the author's ruling A).
   *
   * Absent or blank is the ordinary case and stores NULL. When present it is
   * stored exactly as the reader typed it — see the scrub note below for why
   * that is not an inconsistency.
   */
  replyTo?: string | null;
  suspectReason?: "VELOCITY" | "LIMITER_UNAVAILABLE" | null;
  marker?: RunMarker;
}

/**
 * Store one message. Throws only on a CALLER bug (an empty or oversized
 * message, an unknown surface) — those are 400s the route catches, not
 * conditions a reader can create through the form.
 */
export async function writeFeedback(
  submission: FeedbackSubmission,
): Promise<FeedbackWriteResult> {
  const raw = submission.message.trim();
  if (!raw) throw new Error("feedback message is empty");
  if (raw.length > FEEDBACK_MAX_CHARS) {
    throw new Error(`feedback message exceeds ${FEEDBACK_MAX_CHARS} characters`);
  }

  /*
   * T09, before storage and before anything else reads it. The store is
   * described publicly as identifier-free; a reader typing their own number
   * into a complaint about a wrong number must not make that description
   * false. Mechanical, no judgment calls — and the form says out loud that
   * it happens, because a scrub the reader does not know about would silently
   * eat the reply address they meant to leave.
   */
  const message = scrubFreeText(raw);
  if (!message) {
    // Everything they typed was contact-shaped. Storing an empty row would
    // record that someone wrote and nothing about what — worse than useless,
    // because a queue of empties reads as a broken form.
    throw new Error("feedback message is empty after the scrub");
  }

  /*
   * R41: the reply address is NOT scrubbed, and that is the point of the row.
   *
   * T09 exists because a reader typing their phone number into a complaint
   * would quietly falsify the store's public description as identifier-free.
   * A reader typing an address into a field LABELLED as an optional reply
   * address is doing the opposite — a deliberate, disclosed act, for one
   * stated purpose. Scrubbing it would delete the thing they asked for.
   *
   * The exclusion is EXACTLY this one field. The message body above still
   * goes through `scrubFreeText` unchanged, so a reader who puts contact
   * details in their prose is protected exactly as before.
   */
  const replyToRaw = (submission.replyTo ?? "").trim();
  if (replyToRaw.length > REPLY_TO_MAX_CHARS) {
    throw new Error(`feedback reply address exceeds ${REPLY_TO_MAX_CHARS} characters`);
  }
  if (!isReplyToShaped(replyToRaw)) {
    throw new Error("feedback reply address is not shaped like an address");
  }
  const replyTo = replyToRaw || null;

  const marker = submission.marker ?? ORGANIC;

  if (!process.env.DATABASE_URL) return { kind: "NO_STORE" };

  // Ordered after the DATABASE_URL check for the same reason as the search
  // log's: "there is no database" is ordinary, "there is a production
  // database and we are not production" is a misconfiguration that throws.
  assertWriteAllowed("a feedback submission");

  try {
    await getDb()
      .insert(feedback)
      .values({
        receivedAt: new Date().toISOString(),
        message,
        surface: submission.surface,
        replyTo,
        runClass: marker.runClass,
        runId: marker.runClass === "ORGANIC" ? null : marker.runId,
        suspectReason: submission.suspectReason ?? null,
      });
    return { kind: "STORED" };
  } catch (error) {
    // The message never enters the log line — it is the reader's text, and a
    // server log is not one of the places it was promised to go.
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("feedback insert failed:", reason);
    return { kind: "FAILED", reason };
  }
}
