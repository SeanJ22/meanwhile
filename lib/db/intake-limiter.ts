import { createHash } from "node:crypto";

import { lt, sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { intakeLimiter } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/**
 * Authoritative per-device intake counters: one atomic upsert per submission,
 * counted across every instance. The digest is sha256("intake-limiter:" + key),
 * which shares no value with reactions.reaction_key_hash (sha256 of the raw key).
 */

const DIGEST_CONTEXT = "intake-limiter:";

/** A separate counter space so feedback and reactions never share a budget. */
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
 * Counts this submission and returns the device's totals for the current UTC
 * minute and day, including this one; refused submissions still count. Null
 * when there is no database or the write fails: the caller must treat that as
 * unchecked (quarantined as LIMITER_UNAVAILABLE), never as passed.
 */
export async function noteSubmission(
  rawKey: string,
  now: Date = new Date(),
  space: LimiterSpace = "reactions",
): Promise<IntakeCounters | null> {
  if (!process.env.DATABASE_URL) return null;

  // Outside the try: a refused write is a misconfiguration, not LIMITER_UNAVAILABLE.
  assertWriteAllowed("an intake limiter counter");

  const iso = now.toISOString();
  const dayBucket = iso.slice(0, 10);
  const minuteBucket = iso.slice(0, 16);

  try {
    // Every SET expression reads the OLD row: a same-bucket write increments, a new bucket resets.
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
    console.error("intake limiter unavailable", error);
    return null;
  }
}

/** Deletes rows untouched for 48 hours and returns the count deleted. */
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
