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
 * The single write path for Speak Your Mind, so the self-disclosure redaction
 * and abuse triage cannot be skipped. The continuity key is digested as
 * `sha256("speak-your-mind:" + key)`; the prefix keeps it from being
 * equality-joinable with the reaction and limiter digests of the same kind of key.
 */

const SPEAK_KEY_PREFIX = "speak-your-mind:";
const SPEAK_RUN_PREFIX = "speak-run:";

/** Re-exported so the write path and the route read the same cap the surface does. */
export { SPEAK_MAX_CHARS } from "../speak/limits.ts";

export function hashSpeakKey(key: string): string {
  return createHash("sha256").update(`${SPEAK_KEY_PREFIX}${key}`).digest("hex");
}

function hashRunId(runId: string): string {
  return createHash("sha256").update(`${SPEAK_RUN_PREFIX}${runId}`).digest("hex");
}

/** Derived from the column so it cannot diverge from the schema. */
export type SpeakSubjectType = (typeof speakYourMind.subjectType.enumValues)[number];

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

  // Redact first: triage reads the redacted text, so the review queue never carries the writer's identifiers.
  const redacted = redactSelfDisclosure(raw);

  // Triage only marks the row; nothing here notifies anybody.
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
      // Derived from the row's own divisions, never sent.
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
