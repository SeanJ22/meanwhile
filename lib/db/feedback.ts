import {
  FEEDBACK_MAX_CHARS,
  REPLY_TO_MAX_CHARS,
  isReplyToShaped,
  type FeedbackSurface,
  type FeedbackContext,
  feedbackContext,
} from "../feedback/shape.ts";
import { scrubFreeText } from "../log/scrub.ts";
import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, desc, eq, gt } from "drizzle-orm";
import * as schema from "./schema.ts";
import { installDatabaseTransferCounter } from "./transfer.ts";
import { ORGANIC, type RunMarker } from "./run-marker.ts";
import { feedback, feedbackContact } from "./schema.ts";
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

export type FeedbackSite = "live" | "tester";

/** Both directions use the independent feedback branch once configured. */
export function feedbackConnection(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  return env.FEEDBACK_DATABASE_URL || env.DATABASE_URL || null;
}

const databases = new Map<string, ReturnType<typeof drizzle<typeof schema>>>();
function feedbackDb() {
  const connection = feedbackConnection();
  if (!connection) throw new Error("Feedback database is not configured.");
  installDatabaseTransferCounter();
  let db = databases.get(connection);
  if (!db) { db = drizzle(neon(connection), { schema }); databases.set(connection, db); }
  return db;
}

/** Author/Admin read: site is origin, never a reader identifier or referrer. */
export async function readFeedback(input: { readonly since: string; readonly site?: FeedbackSite }) {
  if (!Number.isFinite(Date.parse(input.since))) throw new Error("Feedback since date is invalid.");
  if (input.site !== undefined && input.site !== "live" && input.site !== "tester") throw new Error("Feedback site is invalid.");
  return feedbackDb().select({
    id: feedback.id, receivedAt: feedback.receivedAt, message: feedback.message,
    surface: feedback.surface, site: feedback.site, runClass: feedback.runClass,
    about: feedback.about, zip: feedback.zip, recordId: feedback.recordId,
    runId: feedback.runId, suspectReason: feedback.suspectReason,
    replyAddress: feedbackContact.address,
  }).from(feedback).leftJoin(feedbackContact, eq(feedback.contactRef, feedbackContact.contactRef))
    .where(and(gt(feedback.receivedAt, input.since), input.site ? eq(feedback.site, input.site) : undefined))
    .orderBy(desc(feedback.receivedAt), desc(feedback.id));
}

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

export interface FeedbackSubmission extends FeedbackContext {
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
  const context = feedbackContext(submission);
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

  /*
   * **A-001 · THE HANDLE IS MINTED, NEVER DERIVED.**
   *
   * `randomUUID()`, not `sha256(address)`. A deterministic digest on both
   * sides would be the same join key relocated: two tables holding
   * `sha256(address)` can still be equality-joined, and one of them would be
   * the reader collection store again. A random handle can be joined only
   * where we put it, and we put it in exactly two places.
   *
   * Null when the reader left the field blank, which is most submissions —
   * and a null handle means no row in the delivery store at all, so an
   * ordinary submission leaves no address anywhere.
   */
  const contactRef = replyTo ? randomUUID() : null;

  const marker = submission.marker ?? ORGANIC;

  if (!feedbackConnection()) return { kind: "NO_STORE" };

  // Ordered after the DATABASE_URL check for the same reason as the search
  // log's: "there is no database" is ordinary, "there is a production
  // database and we are not production" is a misconfiguration that throws.
  assertWriteAllowed("a feedback submission");

  try {
    const receivedAt = new Date().toISOString();
    /*
     * A-001 · THE ADDRESS GOES FIRST, AND THAT ORDER IS THE RULE.
     *
     * If the delivery row failed after the feedback row landed, the reader
     * would have asked to be replied to and the handle would point at
     * nothing — an answer promised and quietly not deliverable. The other
     * way round, a failure leaves an orphaned address with no message
     * attached, which is harmless and is cleaned up on the same schedule.
     *
     * Both writes are in one `try`, so a failure of either is reported as a
     * failed submission rather than as a partial success (RULING 100, in a
     * write path).
     */
    if (contactRef && replyTo) {
      await feedbackDb()
        .insert(feedbackContact)
        .values({ contactRef, address: replyTo, receivedAt });
    }
    await feedbackDb()
      .insert(feedback)
      .values({
        receivedAt,
        message,
        surface: submission.surface,
        site: process.env.WTP_SITE === "tester" ? "tester" : "live",
        about: context.about ? scrubFreeText(context.about) || null : null,
        zip: context.zip,
        recordId: context.recordId ? scrubFreeText(context.recordId) || null : null,
        contactRef,
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
