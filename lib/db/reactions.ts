import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { reactions } from "./schema.ts";
import { DIVISION_VINTAGE } from "./search-log.ts";
import { assertWriteAllowed } from "./write-guard.ts";
import type { RunMarker } from "./run-marker.ts";
import {
  coverageTierForOcdIds,
  encodeTierDistribution,
  tierDistributionForOcdIds,
} from "../coverage/zip-tier.ts";
import {
  scaleForTargetType,
  type ReactionTargetType,
  type ReactionValue,
} from "../signal/reactions.ts";

/**
 * The reaction write path. The row records what a reader thought of a public
 * record and roughly where they were looking, never who they are. The
 * continuity key is stored only as an unsalted SHA-256 hash (the key is 128+
 * random bits).
 */

export function hashReactionKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * The run id is namespaced and digested so it can never be joined to
 * `search_log.run_id`, which holds the raw label; a run can still find its own
 * rows by computing the same digest.
 */
export function hashRunId(runId: string): string {
  return createHash("sha256").update(`reaction-run:${runId}`, "utf8").digest("hex");
}

export interface StorableReaction {
  targetType: ReactionTargetType;
  targetId: string;
  reaction: ReactionValue;
  /** Already validated; hashed here. */
  reactionKey: string;
  /** Server-resolved divisions for where the reader was looking. */
  ocdIds: string[];
  /** Why this row is quarantined from the clean pool, or null for a clean row. */
  suspectReason?: "VELOCITY" | "LIMITER_UNAVAILABLE" | null;
  /**
   * The optional verbatim, already trimmed and length-checked, or null (nothing
   * typed, or free text switched off).
   */
  freeText?: string | null;
  /**
   * Whose traffic this is. Required, never defaulted: a write without one
   * throws rather than being stored as a reader.
   */
  marker: RunMarker;
}

/**
 * Upsert one reaction: a changed answer overwrites the browser's prior one
 * for that target (the reactions_key_target_unq index), never accumulates.
 * Returns false when there is no database — accepted, not stored, and the
 * caller says so with a 202.
 */
export async function writeReaction(row: StorableReaction): Promise<boolean> {
  // Checked before the database check so it fails the same way everywhere.
  if (!row.marker || typeof row.marker.runClass !== "string") {
    throw new Error(
      "writeReaction: no run marker. Every reaction write must declare whose " +
        "traffic it is — pass markerFromRequest(request) on the route, or an " +
        "explicit SYNTHETIC marker from a script. There is no default: a row " +
        "the store cannot attribute must not be sold as a reader.",
    );
  }

  if (!process.env.DATABASE_URL) return false;

  assertWriteAllowed("a reaction");

  const occurredAt = new Date().toISOString();
  const suspectReason = row.suspectReason ?? null;
  // Null on ORGANIC so the id can never relate two readers' rows.
  const runId =
    row.marker.runClass === "ORGANIC" || !row.marker.runId
      ? null
      : hashRunId(row.marker.runId);
  await getDb()
    .insert(reactions)
    .values({
      occurredAt,
      targetType: row.targetType,
      targetId: row.targetId,
      reaction: row.reaction,
      // Derived from the target type, never taken from the client.
      scaleVersion: scaleForTargetType(row.targetType).version,
      ocdIds: row.ocdIds,
      divisionVintage: DIVISION_VINTAGE,
      // Every row starts ANONYMOUS; higher tiers come only from verification.
      verificationTier: "ANONYMOUS",
      reactionKeyHash: hashReactionKey(row.reactionKey),
      suspectReason,
      freeText: row.freeText ?? null,
      runClass: row.marker.runClass,
      runId,
      // Derived from the row's own divisions, never sent by the client.
      coverageTier: coverageTierForOcdIds(row.ocdIds),
      // Stored only; no reader surface renders it.
      coverageTierDistribution: encodeTierDistribution(
        tierDistributionForOcdIds(row.ocdIds),
      ),
    })
    .onConflictDoUpdate({
      target: [reactions.reactionKeyHash, reactions.targetType, reactions.targetId],
      set: {
        reaction: row.reaction,
        // A changed answer is re-stamped with today's instrument.
        scaleVersion: scaleForTargetType(row.targetType).version,
        occurredAt,
        ocdIds: row.ocdIds,
        divisionVintage: DIVISION_VINTAGE,
        // An overwrite must never raise a tier.
        verificationTier: sql`${reactions.verificationTier}`,
        // Sticky: an overwrite can never clear a quarantine.
        suspectReason: sql`COALESCE(${reactions.suspectReason}, ${suspectReason})`,
        // Not sticky: the reader's own words, and this path only fires for a row this browser wrote.
        freeText: row.freeText ?? null,
        // An overwrite may move a row out of ORGANIC, never into it.
        runClass: sql`CASE WHEN ${reactions.runClass} = 'ORGANIC' THEN ${row.marker.runClass} ELSE ${reactions.runClass} END`,
        runId: sql`CASE WHEN ${reactions.runClass} = 'ORGANIC' THEN ${runId} ELSE ${reactions.runId} END`,
      },
    });
  return true;
}
