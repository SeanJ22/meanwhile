import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { reactions } from "./schema.ts";
import { DIVISION_VINTAGE } from "./search-log.ts";
import {
  scaleForTargetType,
  type ReactionTargetType,
  type ReactionValue,
} from "../signal/reactions.ts";

/**
 * The reaction write path — the sibling of lib/db/search-log.ts, under the
 * same constitution: the row records what a reader thought of a public
 * record and roughly where they were looking, never who they are.
 *
 * The continuity key arrives raw from the browser and is stored ONLY as a
 * SHA-256 hash. The raw key never touches the database, so even a full dump
 * of the table cannot be joined against a browser's localStorage without
 * that browser's cooperation. No salt: the key itself is 128+ bits of
 * randomness with no structure to dictionary-attack.
 */

export function hashReactionKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export interface StorableReaction {
  targetType: ReactionTargetType;
  targetId: string;
  reaction: ReactionValue;
  /** Already validated; hashed here. */
  reactionKey: string;
  /** Server-resolved divisions for where the reader was looking. */
  ocdIds: string[];
  /**
   * Quarantine, not deletion (T08): why this row is excluded from the
   * clean pool, or null for a clean row. Carries no identifier — only the
   * mechanical reason the intake limits assigned at write time.
   */
  suspectReason?: "VELOCITY" | "LIMITER_UNAVAILABLE" | null;
}

/**
 * Upsert one reaction: a changed answer overwrites the browser's prior one
 * for that target (the reactions_key_target_unq index), never accumulates.
 * Returns false when there is no database — accepted, not stored, and the
 * caller says so with a 202.
 */
export async function writeReaction(row: StorableReaction): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;

  const occurredAt = new Date().toISOString();
  const suspectReason = row.suspectReason ?? null;
  await getDb()
    .insert(reactions)
    .values({
      occurredAt,
      targetType: row.targetType,
      targetId: row.targetId,
      reaction: row.reaction,
      // Which instrument asked. Derived from the target type here, never
      // taken from the client: a browser does not get to say what question
      // it was showing, and a stale one saying "version 1" would blend two
      // instruments into one column.
      scaleVersion: scaleForTargetType(row.targetType).version,
      ocdIds: row.ocdIds,
      divisionVintage: DIVISION_VINTAGE,
      // Every row starts ANONYMOUS; higher tiers are earned by future
      // verification (T02), never claimed at write time.
      verificationTier: "ANONYMOUS",
      reactionKeyHash: hashReactionKey(row.reactionKey),
      suspectReason,
    })
    .onConflictDoUpdate({
      target: [reactions.reactionKeyHash, reactions.targetType, reactions.targetId],
      set: {
        reaction: row.reaction,
        // A changed answer is re-stamped with today's instrument, because
        // the answer it replaces was given on today's instrument too — the
        // upsert only ever fires for a row this browser wrote.
        scaleVersion: scaleForTargetType(row.targetType).version,
        occurredAt,
        ocdIds: row.ocdIds,
        divisionVintage: DIVISION_VINTAGE,
        // Never sql`excluded.verification_tier` — an overwrite must not be
        // able to *raise* a tier; verification does that through its own path.
        verificationTier: sql`${reactions.verificationTier}`,
        // Sticky by COALESCE (T08): once a row is quarantined, an overwrite
        // can never clear it — a burst would otherwise launder itself clean
        // by re-submitting the same targets at human pace. Only the author
        // clears suspects, through their own review, never this path.
        suspectReason: sql`COALESCE(${reactions.suspectReason}, ${suspectReason})`,
      },
    });
  return true;
}
