import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { reactions } from "./schema.ts";
import { DIVISION_VINTAGE } from "./search-log.ts";
import { assertWriteAllowed } from "./write-guard.ts";
import type { RunMarker } from "./run-marker.ts";
import { coverageTierForOcdIds } from "../coverage/zip-tier.ts";
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

/**
 * **The run id, in its own space** (F01-continued session 2, item 0D,
 * 2026-08-19).
 *
 * Item 0D asked for `run_class` / `run_id` on `reactions`, matching the shape
 * the search log uses. It collided head-on with a guard that already existed
 * and said exactly why:
 *
 * > `assert.ok(!reactionCols.has("run_id"), "run_id on both stores would be a
 * > join path");`
 *
 * That guard is right. `CLAUDE.md`'s n-stores rule is not a preference — "No
 * store carries a column that could join to another, and there is no mapping
 * table between any pair" — and a literal shared `run_id` is a mapping table
 * spelled differently. It would relate a run's SEARCHES to that run's
 * REACTIONS.
 *
 * The counter-argument is real but not sufficient: `run_id` is null on every
 * ORGANIC row, so a literal shared id could only ever join our own robots to
 * each other, never a reader's search to a reader's reaction. The trouble is
 * that this is a property of the DATA rather than of the SCHEMA, and the
 * n-stores rule is deliberately a schema rule — it is written so it can be
 * asserted mechanically rather than argued about, which is why it has held.
 *
 * So the run id is stored **namespaced and digested**, which is this
 * codebase's own precedent rather than a new invention. `CLAUDE.md` describes
 * the intake limiter doing the identical thing for the identical reason: a
 * digest "deliberately different from the reaction store's continuity hash
 * (`sha256("intake-limiter:" + key)` vs `sha256(key)`)".
 *
 * The result satisfies both:
 *
 * * the row **declares** which run wrote it, so a session can find and
 *   exclude its own rows — it knows its own run id and computes the same
 *   digest;
 * * the value **cannot be joined** to `search_log.run_id`, which holds the
 *   raw label in a different space. No query relates the two stores, and the
 *   guard stays armed in a stronger form: it now asserts the digest rather
 *   than merely the absence of a column.
 *
 * The SHAPE matches the search log — two columns, the same names, the same
 * class enum, the same null-on-ORGANIC rule. Only the id's ENCODING differs,
 * and this comment is why.
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
  /**
   * Quarantine, not deletion (T08): why this row is excluded from the
   * clean pool, or null for a clean row. Carries no identifier — only the
   * mechanical reason the intake limits assigned at write time.
   */
  suspectReason?: "VELOCITY" | "LIMITER_UNAVAILABLE" | null;
  /**
   * The optional verbatim (P03), already trimmed and length-checked, or null.
   *
   * Null when the reader typed nothing AND when the free-text ripcord is out
   * — the route decides which, and both arrive here as the same null,
   * because the row's job is to record what was stored and not why.
   */
  freeText?: string | null;
  /**
   * **WHOSE TRAFFIC THIS IS — required, not defaulted** (F01-continued
   * session 2, item 0D, 2026-08-19).
   *
   * The search log takes the same marker and defaults a caller that says
   * nothing to `ORGANIC`. That default has cost this project twice in one
   * day — a `curl` deploy check landed four rows in the sold store labelled
   * as readers, and `pnpm overlaps` landed one.
   *
   * A reaction row is the thing the business sells, so it is not defaulted
   * here. Every caller declares, and a caller that does not gets a thrown
   * error rather than a row that says "reader". The route's declaration comes
   * from `markerFromRequest`, which resolves an absent header to `ORGANIC` —
   * so a real browser is still a reader, decided in ONE place that can be
   * read, instead of by an implicit default nobody sees.
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
  // The declaration is REQUIRED (item 0D), and it is checked FIRST — before
  // the database check and before the write guard. A caller that did not
  // declare is malformed on its own terms, and it must fail the same way
  // whether or not a database happens to be reachable: a refusal that only
  // fires in production is a refusal the suite cannot see.
  if (!row.marker || typeof row.marker.runClass !== "string") {
    throw new Error(
      "writeReaction: no run marker. Every reaction write must declare whose " +
        "traffic it is — pass markerFromRequest(request) on the route, or an " +
        "explicit SYNTHETIC marker from a script. There is no default: a row " +
        "the store cannot attribute must not be sold as a reader.",
    );
  }

  if (!process.env.DATABASE_URL) return false;

  // See the note in search-log.ts: no database is a state, the wrong database
  // is a misconfiguration. A reaction is the highest-value row in the product,
  // so this refusal is the one that matters most.
  assertWriteAllowed("a reaction");

  const occurredAt = new Date().toISOString();
  const suspectReason = row.suspectReason ?? null;
  // Null on ORGANIC by construction, exactly as on the search log, so the id
  // can never relate two readers' rows to each other.
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
      freeText: row.freeText ?? null,
      runClass: row.marker.runClass,
      runId,
      // RULING 6 / item 8. A reaction is the highest-value row in the
      // product, and interest from a Tier 3 zip with forty candidate cards
      // is not the same measurement as interest from a Tier 0 zip with none.
      // Derived from the row's own divisions here, never sent by the client.
      coverageTier: coverageTierForOcdIds(row.ocdIds),
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
        /*
         * The verbatim on an overwrite (P03).
         *
         * NOT sticky, unlike the quarantine mark above, and the two differ
         * for opposite reasons. A quarantine is a finding ABOUT the row that
         * the row must not be able to clear about itself. A verbatim is the
         * reader's own words, and this path only ever fires for a row THIS
         * browser wrote — so a reader who changes their answer and rewrites
         * their comment gets the comment they meant, and one who clears the
         * box has cleared it. Anything else would keep words a person
         * deliberately deleted.
         */
        freeText: row.freeText ?? null,
        /*
         * THE CLASS ON AN OVERWRITE MOVES ONE WAY ONLY (item 0D).
         *
         * An overwrite may take a row OUT of what is sold and may never put
         * one in. So an `ORGANIC` row that is overwritten by a declared run
         * becomes that run's; a row already `SYNTHETIC`, `UNKNOWN` or
         * `AUTHOR` keeps what it has, whatever the incoming declaration says.
         *
         * Same shape as the `suspectReason` COALESCE above and the same
         * reason: a write must not be able to launder its own row clean. The
         * verification tier is held for the same reason one line up, and all
         * three are the single rule that an overwrite can lower a row's
         * standing in the sold pool but never raise it.
         */
        runClass: sql`CASE WHEN ${reactions.runClass} = 'ORGANIC' THEN ${row.marker.runClass} ELSE ${reactions.runClass} END`,
        runId: sql`CASE WHEN ${reactions.runClass} = 'ORGANIC' THEN ${runId} ELSE ${reactions.runId} END`,
      },
    });
  return true;
}
