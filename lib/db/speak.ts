import { createHash } from "node:crypto";

import { SPEAK_MAX_CHARS } from "../speak/limits.ts";
import { redactSelfDisclosure } from "../speak/self-disclosure.ts";
import { triage } from "../speak/triage.ts";

import {
  coverageTierForOcdIds,
  encodeTierDistribution,
  tierDistributionForOcdIds,
} from "../coverage/zip-tier.ts";

import { getDb } from "./index.ts";
import { ORGANIC, type RunMarker } from "./run-marker.ts";
import { speakYourMind } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/**
 * **BC-11 — the SINGLE write path for Speak Your Mind.**
 *
 * One path, so the redaction and the triage cannot be skipped by a second
 * caller. That is the same argument that put the search log's scrub in its
 * write path rather than in its route, and it matters more here: the two
 * things this path does — RULE 3's self-disclosure pass and RULE 4's abuse
 * triage — are the two the author said must exist BEFORE any export path
 * does. A second insert site that forgot either would be a row born unsafe.
 *
 * ## The continuity key has its OWN digest space, and that is RULE 1
 *
 * `sha256("speak-your-mind:" + key)`. The reactions store hashes the same kind
 * of browser-minted key as `sha256(key)` and the intake limiter as
 * `sha256("intake-limiter:" + key)`. Without the prefix all three would be the
 * same digest of the same input — **equality-joinable across three stores that
 * the constitution says share no key**. The prefix is the whole boundary, and
 * `tests/identity-boundary.test.ts` proves it over the values (RULING 132).
 */

const SPEAK_KEY_PREFIX = "speak-your-mind:";
const SPEAK_RUN_PREFIX = "speak-run:";

/** The cap. One home (lib/speak/limits.ts), re-exported so the write path and
 *  the route read the same number the surface does. */
export { SPEAK_MAX_CHARS } from "../speak/limits.ts";

export function hashSpeakKey(key: string): string {
  return createHash("sha256").update(`${SPEAK_KEY_PREFIX}${key}`).digest("hex");
}

function hashRunId(runId: string): string {
  return createHash("sha256").update(`${SPEAK_RUN_PREFIX}${runId}`).digest("hex");
}

export type SpeakSubjectType = "OFFICIAL" | "BODY" | "MEETING";

export type SpeakWriteResult =
  /** It is in the store. The only outcome a reader may be thanked for. */
  | { kind: "STORED"; held: boolean }
  /** No database configured — real, honest to say, and NOT a success. */
  | { kind: "NO_STORE" }
  /** The insert was attempted and failed. Told plainly, never swallowed. */
  | { kind: "FAILED"; reason: string };

export interface SpeakSubmission {
  subjectType: SpeakSubjectType;
  /** The subject's public identifier. Who was spoken ABOUT, never who spoke. */
  subjectId: string;
  /** The reader's zip-resolved divisions. District-stamped, never an address. */
  ocdIds: string[];
  divisionVintage: string;
  text: string;
  /** The random browser-minted continuity key. Stored ONLY hashed. */
  continuityKey: string;
  suspectReason?: "VELOCITY" | "LIMITER_UNAVAILABLE" | null;
  marker?: RunMarker;
}

export async function writeSpeakYourMind(
  submission: SpeakSubmission,
): Promise<SpeakWriteResult> {
  const raw = submission.text.trim();
  if (!raw) throw new Error("speak-your-mind text is empty");
  if (raw.length > SPEAK_MAX_CHARS) {
    throw new Error(`speak-your-mind text exceeds ${SPEAK_MAX_CHARS} characters`);
  }
  if (!submission.continuityKey) {
    throw new Error("speak-your-mind requires a continuity key");
  }

  /*
   * RULE 3 FIRST, and the order is not arbitrary: the triage below reads the
   * REDACTED text, so a phone number or a street address can never be the
   * thing that lands a row in the review queue carrying itself. What the
   * author reviews is a message with the writer's own identifiers already out
   * of it.
   */
  const redacted = redactSelfDisclosure(raw);

  /* RULE 4. Nothing here notifies anybody — see `lib/speak/triage.ts`. */
  const review = triage(redacted.text);

  const marker = submission.marker ?? ORGANIC;
  const db = getDb();
  if (!db) return { kind: "NO_STORE" };

  try {
    assertWriteAllowed("speak_your_mind");
    await db.insert(speakYourMind).values({
      occurredAt: new Date().toISOString(),
      subjectType: submission.subjectType,
      subjectId: submission.subjectId,
      ocdIds: submission.ocdIds,
      divisionVintage: submission.divisionVintage,
      // Item 8.4: derived HERE from the row's own divisions, never sent.
      coverageTier: coverageTierForOcdIds(submission.ocdIds),
      coverageTierDistribution: encodeTierDistribution(
        tierDistributionForOcdIds(submission.ocdIds),
      ),
      text: redacted.text,
      selfDisclosure: redacted.flags,
      reviewState: review.reviewState,
      reviewReason: review.reviewReason,
      speakKeyHash: hashSpeakKey(submission.continuityKey),
      suspectReason: submission.suspectReason ?? null,
      runClass: marker.runClass,
      runId: marker.runId ? hashRunId(marker.runId) : null,
    });
    return { kind: "STORED", held: review.reviewState === "HELD" };
  } catch (error) {
    return {
      kind: "FAILED",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
