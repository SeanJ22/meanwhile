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
 * The single write path for reader feedback, so the scrub cannot be skipped.
 * Returns a named outcome: a submission never silently succeeds into a void.
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
  /** The only outcome a reader may be thanked for. */
  | { kind: "STORED" }
  /** No database configured. Not a success. */
  | { kind: "NO_STORE" }
  | { kind: "FAILED"; reason: string };

export interface FeedbackSubmission extends FeedbackContext {
  message: string;
  surface: FeedbackSurface;
  /** Optional reply address; stored exactly as typed (not scrubbed). Blank stores NULL. */
  replyTo?: string | null;
  suspectReason?: "VELOCITY" | "LIMITER_UNAVAILABLE" | null;
  marker?: RunMarker;
}

/** Throws only on a caller bug (empty or oversized message, unknown surface). */
export async function writeFeedback(
  submission: FeedbackSubmission,
): Promise<FeedbackWriteResult> {
  const raw = submission.message.trim();
  if (!raw) throw new Error("feedback message is empty");
  if (raw.length > FEEDBACK_MAX_CHARS) {
    throw new Error(`feedback message exceeds ${FEEDBACK_MAX_CHARS} characters`);
  }

  const message = scrubFreeText(raw);
  const context = feedbackContext(submission);
  if (!message) {
    // An all-contact-shaped message would store an empty row.
    throw new Error("feedback message is empty after the scrub");
  }

  // The reply address alone is not scrubbed: the reader typed it into a field
  // labelled for that purpose. The message body above is still scrubbed.
  const replyToRaw = (submission.replyTo ?? "").trim();
  if (replyToRaw.length > REPLY_TO_MAX_CHARS) {
    throw new Error(`feedback reply address exceeds ${REPLY_TO_MAX_CHARS} characters`);
  }
  if (!isReplyToShaped(replyToRaw)) {
    throw new Error("feedback reply address is not shaped like an address");
  }
  const replyTo = replyToRaw || null;

  // A random handle, never a digest of the address, so it joins only where we put it.
  // Null when blank: no row in the delivery store at all.
  const contactRef = replyTo ? randomUUID() : null;

  const marker = submission.marker ?? ORGANIC;

  if (!feedbackConnection()) return { kind: "NO_STORE" };

  // After the DATABASE_URL check: no database is ordinary; a production database
  // outside production throws.
  assertWriteAllowed("a feedback submission");

  try {
    const receivedAt = new Date().toISOString();
    // The address is written first so a failure never leaves a handle pointing at nothing.
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
    // The message never enters the log line.
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("feedback insert failed:", reason);
    return { kind: "FAILED", reason };
  }
}
