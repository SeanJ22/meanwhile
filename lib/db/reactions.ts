import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { reactions } from "./schema.ts";
import { DIVISION_VINTAGE } from "./search-log.ts";
import type {
  ReactionTargetType,
  ReactionValue,
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
  await getDb()
    .insert(reactions)
    .values({
      occurredAt,
      targetType: row.targetType,
      targetId: row.targetId,
      reaction: row.reaction,
      ocdIds: row.ocdIds,
      divisionVintage: DIVISION_VINTAGE,
      // Every row starts ANONYMOUS; higher tiers are earned by future
      // verification (T02), never claimed at write time.
      verificationTier: "ANONYMOUS",
      reactionKeyHash: hashReactionKey(row.reactionKey),
    })
    .onConflictDoUpdate({
      target: [reactions.reactionKeyHash, reactions.targetType, reactions.targetId],
      set: {
        reaction: row.reaction,
        occurredAt,
        ocdIds: row.ocdIds,
        divisionVintage: DIVISION_VINTAGE,
        // Never sql`excluded.verification_tier` — an overwrite must not be
        // able to *raise* a tier; verification does that through its own path.
        verificationTier: sql`${reactions.verificationTier}`,
      },
    });
  return true;
}
