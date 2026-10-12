import { createHash } from "node:crypto";

import {
  contactShapesIn,
  scrubContactShapes,
  scrubFreeText,
  SCRUB_MARK,
} from "../log/scrub.ts";
import {
  coverageTierForOcdIds,
  encodeTierDistribution,
  tierDistributionForOcdIds,
} from "../coverage/zip-tier.ts";
import { redactSelfDisclosure, type SelfDisclosureFlag } from "../speak/self-disclosure.ts";
import type { AnswerMode } from "../ask/trace.ts";
import type { EvidenceProvenance } from "../ask/evidence.ts";
import type { LocationConfidence, ResidencyRelation } from "../ask/residency.ts";

/**
 * The Ask interaction write path. Each store digests the browser key under its
 * own prefix so no two reader stores share a joinable hash:
 *   reactions       sha256(rawKey)
 *   speak your mind sha256("speak-your-mind:" + key)
 *   intake limiter  sha256("intake-limiter:" + key)
 *   ask             sha256("ask-interaction:" + key)
 */

const ASK_KEY_PREFIX = "ask-interaction:";
const ASK_RUN_PREFIX = "ask-run:";

/** The continuity digest. Counts DISTINCT READERS; never a buyer-visible id. */
export function askKeyHash(key: string): string {
  return createHash("sha256").update(`${ASK_KEY_PREFIX}${key}`).digest("hex");
}

export function askRunHash(runId: string): string {
  return createHash("sha256").update(`${ASK_RUN_PREFIX}${runId}`).digest("hex");
}

export interface AskInteractionInput {
  /** Raw reader text; scrubbed only here, at the single write path. */
  question: string;
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
  answerMode: AnswerMode;
  /** Raw delivered answer; scrubbed here too. */
  answerText: string | null;
  answerModel: string | null;
  validationPassed: boolean | null;
  evidenceRecordCount: number;
  evidenceSourceCount: number;
  namedGapCount: number;
  evidenceProvenance: EvidenceProvenance;
  surface: "MAP" | "BALLOT" | "UNKNOWN";
  /** Coarse orientation only; see normalizeApproximateLocation. */
  approximateLocation: string | null;
  ocdIds: string[];
  divisionVintage: string;
  residencyRelation: ResidencyRelation;
  locationConfidence: LocationConfidence;
  coverageTier: "TIER_0" | "TIER_1" | "TIER_2" | "TIER_3" | "UNKNOWN";
  coverageTierDistribution: string;
  /** Raw browser-minted key; digested here, never stored raw. */
  continuityKey: string;
  runClass?: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" | "AUTHOR";
  runId?: string | null;
  occurredAt: string;
}

export interface AskInteractionRow {
  occurredAt: string;
  questionScrubbed: string;
  /** The scrubbed answer, never the reader-visible copy. */
  answerText: string | null;
  /** Flags from the question and the answer, merged. */
  selfDisclosure: string[];
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: AskInteractionInput["resolutionState"];
  answerMode: AnswerMode;
  answerModel: string | null;
  validationPassed: boolean | null;
  evidenceRecordCount: number;
  evidenceSourceCount: number;
  namedGapCount: number;
  evidenceRecordRefs: string[];
  evidenceSourceUrls: string[];
  evidenceSourceOrgs: string[];
  evidenceRetrievedFrom: string | null;
  evidenceRetrievedTo: string | null;
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

export const ASK_QUESTION_MAX_CHARS = 400;
export const ASK_ANSWER_MAX_CHARS = 4000;

/** A five-digit ZIP or a short place label with no digits; anything else is stored as null. */
export function normalizeApproximateLocation(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{5}$/.test(value)) return value;
  if (value.length <= 60 && /^[A-Za-z][A-Za-z\s.,'’-]*$/.test(value)) return value;
  return null;
}

/**
 * The stored answer is scrubbed by shape (emails, long digit runs) and by echo
 * (the exact values the question's pass removed, which is the only way a name
 * is caught). It does not use scrubFreeText, whose number-plus-words shape
 * would also strike every printed date. The on-screen answer is untouched.
 */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
}

/** Each value plus, for multi-word values, its words of 3+ characters; longest first. */
function echoTargets(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 1) out.add(trimmed);
    if (/\s/.test(trimmed)) {
      for (const word of trimmed.split(/\s+/)) {
        if (word.length >= 3) out.add(word);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrubStoredAnswer(
  answer: string,
  redactedValues: readonly string[] = [],
): { text: string; flags: SelfDisclosureFlag[] } {
  const flags = new Set<SelfDisclosureFlag>();
  const shapes = contactShapesIn(answer);
  if (shapes.email) flags.add("EMAIL");
  if (shapes.digits) flags.add("PHONE_OR_NUMBER");

  let text = scrubContactShapes(answer);

  for (const value of echoTargets(redactedValues)) {
    if (!value) continue;
    // Word-bounded, so a value cannot cut a longer word in half.
    const pattern = new RegExp(`\\b${escapeLiteral(value)}\\b`, "gi");
    if (pattern.test(text)) {
      text = text.replace(pattern, SCRUB_MARK);
      flags.add("SELF_NAMED");
    }
  }

  return { text: text.trim(), flags: [...flags] };
}

/** Stamped here, not in a route: the tier distribution must never enter app/ or components/. */
export function askCoverageStamp(ocdIds: readonly string[]): {
  coverageTier: AskInteractionInput["coverageTier"];
  coverageTierDistribution: string;
} {
  return {
    coverageTier: coverageTierForOcdIds([...ocdIds]),
    coverageTierDistribution: encodeTierDistribution(tierDistributionForOcdIds([...ocdIds])),
  };
}

/** Pure. The only place questions and answers are scrubbed before storage. */
export function prepareAskInteraction(input: AskInteractionInput): AskInteractionRow {
  const raw = input.question.slice(0, ASK_QUESTION_MAX_CHARS);
  // redactSelfDisclosure must run before the scrub, which replaces the tokens it detects.
  const disclosure = redactSelfDisclosure(raw);
  const answer = input.answerText
    ? scrubStoredAnswer(
        input.answerText.slice(0, ASK_ANSWER_MAX_CHARS),
        disclosure.redactedValues,
      )
    : null;

  const flags = [...new Set([...disclosure.flags, ...(answer?.flags ?? [])])];

  return {
    occurredAt: input.occurredAt,
    questionScrubbed: scrubFreeText(disclosure.text),
    answerText: answer ? answer.text : null,
    selfDisclosure: flags,
    intent: input.intent,
    temporalKind: input.temporalKind,
    subjectIds: input.subjectIds,
    resolutionState: input.resolutionState,
    answerMode: input.answerMode,
    answerModel: input.answerModel,
    validationPassed: input.validationPassed,
    evidenceRecordCount: input.evidenceRecordCount,
    evidenceSourceCount: input.evidenceSourceCount,
    namedGapCount: input.namedGapCount,
    evidenceRecordRefs: input.evidenceProvenance.recordRefs,
    evidenceSourceUrls: input.evidenceProvenance.sourceUrls,
    evidenceSourceOrgs: input.evidenceProvenance.sourceOrgs,
    evidenceRetrievedFrom: input.evidenceProvenance.retrievedFrom,
    evidenceRetrievedTo: input.evidenceProvenance.retrievedTo,
    surface: input.surface,
    approximateLocation: normalizeApproximateLocation(input.approximateLocation),
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

/** The coverage stamp is derived here; an explicit caller value wins. */
export type AskCaptureInput = Omit<
  AskInteractionInput,
  "coverageTier" | "coverageTierDistribution"
> &
  Partial<Pick<AskInteractionInput, "coverageTier" | "coverageTierDistribution">>;

export type AskCaptureOutcome =
  | { kind: "WROTE" }
  | { kind: "FAILED"; why: string; error?: unknown };

/**
 * Write one interaction through the production writer by default. Tests may
 * supply a writer without opening a database. Failure never discards an answer.
 */
export async function captureAskInteraction(
  input: AskCaptureInput,
  write: (row: AskInteractionRow, signal?: AbortSignal) => Promise<void> = async (row, signal) => {
    const { writeAskInteraction } = await import("./ask-interaction-writer.ts");
    await writeAskInteraction(row, signal);
  },
  signal?: AbortSignal,
): Promise<AskCaptureOutcome> {
  // An empty key would hash identically for every reader, collapsing distinct readers to one.
  if (!input.continuityKey) {
    return { kind: "FAILED", why: "no continuity key — minting is part of activation" };
  }
  try {
    const row = prepareAskInteraction({
      ...askCoverageStamp(input.ocdIds),
      ...input,
    });
    await write(row, signal);
    return { kind: "WROTE" };
  } catch (error) {
    return { kind: "FAILED", why: error instanceof Error ? error.message : "unknown", error };
  }
}
