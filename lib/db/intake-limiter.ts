import { createHash } from "node:crypto";

import { lt, sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { intakeLimiter } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/**
 * The authoritative per-device intake counters (T08) — one upsert per
 * submission, atomic, counted across every serverless instance. The
 * in-memory sliding windows in the routes are the cheap first line; this
 * table is the line a multi-instance burst cannot slip through.
 *
 * Isolation is the whole design (see the schema header): the digest here
 * is sha256 of "intake-limiter:" + the raw key, which shares no value with
 * reactions.reaction_key_hash (sha256 of the raw key alone). The raw key
 * exists only inside the request; neither table can reach the other.
 */

const DIGEST_CONTEXT = "intake-limiter:";

/**
 * A SECOND, separately-bucketed counter space (R40, 2026-08-17).
 *
 * The feedback form is rate-limited too, and it must not share a counter with
 * reactions in either direction: a reader who has been tapping answers all
 * afternoon must still be able to report a wrong number, and someone pumping
 * the feedback form must not be spending a budget that also gates reactions.
 * A different context string is a different digest is a different row — the
 * same isolation argument the limiter already makes against the stores it
 * protects, applied between two protected paths.
 */
const FEEDBACK_DIGEST_CONTEXT = "feedback-limiter:";

export type LimiterSpace = "reactions" | "feedback";

function contextFor(space: LimiterSpace): string {
  return space === "feedback" ? FEEDBACK_DIGEST_CONTEXT : DIGEST_CONTEXT;
}

export function hashLimiterKey(
  rawKey: string,
  space: LimiterSpace = "reactions",
): string {
  return createHash("sha256")
    .update(contextFor(space) + rawKey, "utf8")
    .digest("hex");
}

export interface IntakeCounters {
  minuteCount: number;
  dayCount: number;
}

/**
 * Count this submission and return the device's totals for the current
 * UTC minute and day, including this one. Counters increment even for
 * submissions later refused — an attacker's refused attempts keep the
 * pressure visible rather than resetting it.
 *
 * Returns null when there is no database or the write fails: the caller
 * must treat that as "the limit could not be checked" (the row lands
 * quarantined as LIMITER_UNAVAILABLE), never as "the limit passed".
 */
export async function noteSubmission(
  rawKey: string,
  now: Date = new Date(),
  space: LimiterSpace = "reactions",
): Promise<IntakeCounters | null> {
  if (!process.env.DATABASE_URL) return null;

  // Deliberately OUTSIDE the try below. A refused write is a misconfiguration
  // and must not be laundered into LIMITER_UNAVAILABLE, which means "the
  // limiter is down, quarantine the row" — a different fact with a different
  // fix, and the one an operator would go chasing.
  assertWriteAllowed("an intake limiter counter");

  const iso = now.toISOString();
  const dayBucket = iso.slice(0, 10);
  const minuteBucket = iso.slice(0, 16);

  try {
    // Postgres evaluates every SET expression against the OLD row, so the
    // CASEs read the previous buckets even though the buckets are also
    // being replaced — a same-bucket write increments, a new bucket resets.
    const rows = await getDb()
      .insert(intakeLimiter)
      .values({
        digest: hashLimiterKey(rawKey, space),
        dayBucket,
        dayCount: 1,
        minuteBucket,
        minuteCount: 1,
        updatedAt: iso,
      })
      .onConflictDoUpdate({
        target: intakeLimiter.digest,
        set: {
          dayCount: sql`CASE WHEN ${intakeLimiter.dayBucket} = ${dayBucket} THEN ${intakeLimiter.dayCount} + 1 ELSE 1 END`,
          dayBucket: sql`${dayBucket}`,
          minuteCount: sql`CASE WHEN ${intakeLimiter.minuteBucket} = ${minuteBucket} THEN ${intakeLimiter.minuteCount} + 1 ELSE 1 END`,
          minuteBucket: sql`${minuteBucket}`,
          updatedAt: sql`${iso}`,
        },
      })
      .returning({
        minuteCount: intakeLimiter.minuteCount,
        dayCount: intakeLimiter.dayCount,
      });
    return rows[0] ?? null;
  } catch (error) {
    // The limiter's failure is logged (no identifier in the message) and
    // reported as unchecked — the caller quarantines rather than trusts.
    console.error("intake limiter unavailable", error);
    return null;
  }
}

/**
 * Expiry on the limiter's own schedule (the n-stores isolation contract):
 * rows untouched for 48 hours carry no live limit and are deleted. Run by
 * the daily tripwire. Returns the count deleted — an operation that can
 * do nothing must say what it did.
 */
export async function purgeExpiredLimiterState(
  now: Date = new Date(),
): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  assertWriteAllowed("an intake limiter purge");
  const cutoff = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
  const deleted = await getDb()
    .delete(intakeLimiter)
    .where(lt(intakeLimiter.updatedAt, cutoff))
    .returning({ digest: intakeLimiter.digest });
  return deleted.length;
}
