import { createHash } from "node:crypto";

import { scrubFreeText } from "../log/scrub.ts";
import { redactSelfDisclosure } from "../speak/self-disclosure.ts";
import { ripcordPulled } from "../ripcords.ts";
import type { AnswerMode } from "../ask/trace.ts";
import type { LocationConfidence, ResidencyRelation } from "../ask/residency.ts";

/**
 * **THE ASK INTERACTION WRITE PATH — built, tested, and NOT RUNNING.**
 * (ASK03, 2026-08-27.)
 *
 * ## The gate is the first thing in this file for a reason
 *
 * `ripcord.askSignalCapture` ships PULLED. The data-privacy policy's rule is
 * unambiguous and it is not a preference:
 *
 * > **HONEST DISCLOSURE AT THE BOX.** One line, plain language, before the
 * > reader types: what is written may be shared — without a name, because we
 * > do not hold one — with campaigns, organizations and researchers.
 *
 * A reader's typed question entering a store whose aggregates may reach
 * campaigns is exactly that case. The disclosure copy is drafted on NH246 and
 * the author has not approved it, and this session was explicitly instructed
 * not to put new privacy copy in front of a reader. So the path is complete
 * and the flag is down: approval becomes a one-flip activation rather than a
 * build, and until then nothing is written.
 *
 * `prepareAskInteraction` is pure and is exported separately from the write so
 * the SHAPE can be tested exhaustively without a database and without the
 * capability being live.
 *
 * ## The continuity key has its own digest space, and that is the boundary
 *
 * Four stores now hash a browser-minted key. If they all digested the raw
 * value they would produce the SAME hash for the same browser — equality
 * joinable across stores the constitution says share no key, on a value nobody
 * would have to look up. The prefix is the whole boundary.
 *
 *   reactions       sha256(rawKey)                       (its own, unprefixed)
 *   speak your mind sha256("speak-your-mind:" + key)
 *   intake limiter  sha256("intake-limiter:" + key)
 *   ask             sha256("ask-interaction:" + key)     <- this file
 */

const ASK_KEY_PREFIX = "ask-interaction:";
const ASK_RUN_PREFIX = "ask-run:";

/** The continuity digest. Counts DISTINCT READERS; never a buyer-visible id. */
export function askKeyHash(key: string): string {
  return createHash("sha256").update(`${ASK_KEY_PREFIX}${key}`).digest("hex");
}

/** Namespaced like every other run id, for the same reason. */
export function askRunHash(runId: string): string {
  return createHash("sha256").update(`${ASK_RUN_PREFIX}${runId}`).digest("hex");
}

export interface AskInteractionInput {
  /** RAW reader text. Scrubbed here, at the single write path, never before. */
  question: string;
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
  answerMode: AnswerMode;
  answerText: string | null;
  answerModel: string | null;
  validationPassed: boolean | null;
  evidenceRecordCount: number;
  evidenceSourceCount: number;
  namedGapCount: number;
  surface: "MAP" | "BALLOT" | "UNKNOWN";
  approximateLocation: string | null;
  ocdIds: string[];
  divisionVintage: string;
  residencyRelation: ResidencyRelation;
  locationConfidence: LocationConfidence;
  coverageTier: "TIER_0" | "TIER_1" | "TIER_2" | "TIER_3" | "UNKNOWN";
  coverageTierDistribution: string;
  /** The browser-minted continuity value, RAW. Digested here, never stored raw. */
  continuityKey: string;
  runClass?: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" | "AUTHOR";
  runId?: string | null;
  occurredAt: string;
}

export interface AskInteractionRow {
  occurredAt: string;
  questionScrubbed: string;
  selfDisclosure: string[];
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: AskInteractionInput["resolutionState"];
  answerMode: AnswerMode;
  answerText: string | null;
  answerModel: string | null;
  validationPassed: boolean | null;
  evidenceRecordCount: number;
  evidenceSourceCount: number;
  namedGapCount: number;
  surface: AskInteractionInput["surface"];
  approximateLocation: string | null;
  ocdIds: string[];
  divisionVintage: string;
  residencyRelation: ResidencyRelation;
  locationConfidence: LocationConfidence;
  coverageTier: AskInteractionInput["coverageTier"];
  coverageTierDistribution: string;
  askKeyHash: string;
  runClass: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" | "AUTHOR";
  runId: string | null;
}

/** How long a stored question may be. The roadmap needs it, never a novel. */
export const ASK_QUESTION_MAX_CHARS = 400;
/** And the answer. Long enough to be the answer, short enough to be a row. */
export const ASK_ANSWER_MAX_CHARS = 4000;

/**
 * Build the row. **Pure**, so the shape is testable without a database and
 * without the capability being live.
 *
 * The scrub happens HERE and only here. There is no second path that writes a
 * question, so there is no way for raw text to reach the store — which is the
 * difference between a store that is born safe and one that is promised to be.
 */
export function prepareAskInteraction(input: AskInteractionInput): AskInteractionRow {
  const raw = input.question.slice(0, ASK_QUESTION_MAX_CHARS);
  /*
   * **ORDER IS LOAD-BEARING AND IT IS NOT MINE TO CHOOSE.**
   *
   * `redactSelfDisclosure` runs FIRST because, as its own header says, the
   * scrub replaces the very tokens that would have to be detected — asking
   * afterwards reports nothing on every row, which is a pass that always
   * passes. It also strips self-naming, which the scrub knows nothing about.
   * Then the scrub blanks the email, phone and address shapes.
   *
   * This is the store's whole PII posture and it reuses the pass Speak Your
   * Mind already proved rather than a second one written here.
   */
  const disclosure = redactSelfDisclosure(raw);
  return {
    occurredAt: input.occurredAt,
    questionScrubbed: scrubFreeText(disclosure.text),
    /* The KINDS of thing the reader disclosed about themselves — never the
       values. "they typed an email address" is a fact worth holding; the
       address is the thing this store must never contain. */
    selfDisclosure: disclosure.flags,
    intent: input.intent,
    temporalKind: input.temporalKind,
    subjectIds: input.subjectIds,
    resolutionState: input.resolutionState,
    answerMode: input.answerMode,
    answerText: input.answerText ? input.answerText.slice(0, ASK_ANSWER_MAX_CHARS) : null,
    answerModel: input.answerModel,
    validationPassed: input.validationPassed,
    evidenceRecordCount: input.evidenceRecordCount,
    evidenceSourceCount: input.evidenceSourceCount,
    namedGapCount: input.namedGapCount,
    surface: input.surface,
    approximateLocation: input.approximateLocation,
    ocdIds: input.ocdIds,
    divisionVintage: input.divisionVintage,
    residencyRelation: input.residencyRelation,
    locationConfidence: input.locationConfidence,
    coverageTier: input.coverageTier,
    coverageTierDistribution: input.coverageTierDistribution,
    askKeyHash: askKeyHash(input.continuityKey),
    runClass: input.runClass ?? "UNKNOWN",
    runId: input.runId ? askRunHash(input.runId) : null,
  };
}

export type AskCaptureOutcome =
  | { kind: "WROTE" }
  /** The flag is down. The only outcome today, and it is not an error. */
  | { kind: "GATED"; why: "ripcord" }
  | { kind: "FAILED"; why: string };

/**
 * Write one interaction — **if the capability is live, which today it is not.**
 *
 * The gate is checked here rather than at the call site so that no future
 * caller can reach the store by forgetting to ask. A gated result is a normal
 * return value, not an error: the reader's answer is unaffected either way,
 * and an Ask that answers correctly while storing nothing is precisely the
 * product that ships today.
 */
export async function captureAskInteraction(
  input: AskInteractionInput,
  write?: (row: AskInteractionRow) => Promise<void>,
): Promise<AskCaptureOutcome> {
  if (ripcordPulled("ripcord.askSignalCapture")) {
    return { kind: "GATED", why: "ripcord" };
  }
  const row = prepareAskInteraction(input);
  if (!write) return { kind: "FAILED", why: "no write path supplied" };
  try {
    await write(row);
    return { kind: "WROTE" };
  } catch (error) {
    return { kind: "FAILED", why: error instanceof Error ? error.message : "unknown" };
  }
}
