import { createHash } from "node:crypto";

import {
  coverageTierForOcdIds,
  encodeTierDistribution,
  tierDistributionForOcdIds,
} from "../coverage/zip-tier.ts";
import type { AnswerMode } from "../ask/trace.ts";
import type { EvidenceProvenance } from "../ask/evidence.ts";
import type { LocationConfidence, ResidencyRelation } from "../ask/residency.ts";

/**
 * The Ask interaction write path. Each store digests the browser key under its
 * prefix. Search events use the Ask digest too, so district counts
 * share the same browser continuity:
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
  /** The complete question exactly as the reader typed it. */
  question: string;
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
  answerMode: AnswerMode;
  /** The complete answer exactly as delivered. */
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
  question: string;
  /** The answer exactly as delivered; null when answering failed. */
  answerText: string | null;
  /** Retained schema field; Ask words are stored without redaction. */
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

/** A five-digit ZIP or a place label with no digits; anything else is stored as null. */
export function normalizeApproximateLocation(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{5}$/.test(value)) return value;
  if (/^[A-Za-z][A-Za-z\s.,'’-]*$/.test(value)) return value;
  return null;
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

/** Pure. Preserve the reader's complete question and the delivered answer. */
export function prepareAskInteraction(input: AskInteractionInput): AskInteractionRow {
  return {
    occurredAt: input.occurredAt,
    question: input.question,
    answerText: input.answerText,
    selfDisclosure: [],
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
  write: (row: AskInteractionRow) => Promise<void> = async (row) => {
    const { writeAskInteraction } = await import("./ask-interaction-writer.ts");
    await writeAskInteraction(row);
  },
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
    await write(row);
    return { kind: "WROTE" };
  } catch (error) {
    return { kind: "FAILED", why: error instanceof Error ? error.message : "unknown", error };
  }
}
