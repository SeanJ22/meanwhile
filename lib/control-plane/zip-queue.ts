/** Inert preparation only. Existing stamps, readiness and authority corpora remain authoritative. */
import { COVERAGE_TIER_NEXT_STEP, type CoverageTier } from "../coverage/tier.ts";
import type { StampedZipRow } from "../coverage/zip-tier.ts";
import type { CandidateUniverse } from "../hunt/candidate-universe.ts";
import { applicableDivisions, projectOntoZip } from "../hunt/zip-projection.ts";
import { newZipReadiness, type ReaderProjection } from "../hunt/source-universe.ts";
import type { FreshnessVerdict, GateCell } from "./readiness/gates.ts";
import type { ReadinessReadOutcome } from "./readiness/read.ts";
import type { ZipRow } from "./readiness/model.ts";

export const ZIP_QUEUE_CONTRACT = "fleet/zip-preparation@1";
export const ZIP_COMPLETION_REQUIREMENTS = "docs/zip-playbook.md#1-the-definition-of-done-for-a-zip";

export interface ZipQueueInput {
  readonly zip: string;
  readonly stateCode: string;
  /** An explicit preparation lane, never inferred from a nationwide tier stamp. */
  readonly lane: "existing-completion" | "new-expansion";
  readonly stamp: StampedZipRow | null;
  readonly overlappingDivisions: readonly string[] | undefined;
  readonly corpus: { readonly universe: CandidateUniverse; readonly citation: string } | null;
  /** Existing readiness reader outcome; missing is unknown, never a blank green state. */
  readonly readiness?: ReadinessReadOutcome;
  /** Canonical caller-supplied verdicts; this module introduces no freshness clock or threshold. */
  readonly freshness: {
    readonly stamp: FreshnessVerdict | null;
    readonly corpus: FreshnessVerdict | null;
  };
}

export interface PreparedZip {
  readonly zip: string;
  readonly stateCode: string;
  readonly stampedTier: CoverageTier | "UNKNOWN";
  readonly stampedAt: string | null;
  readonly tierNextStep: string;
  readonly coverageEvidence: StampedZipRow["evidence"] | null;
  /** County-wide unresolved inventory is NOT a count of missing bodies governing this ZIP. */
  readonly unresolvedSpecialDistrictsInCounties: number | null;
  readonly geometryHeld: boolean;
  readonly heldProjection: ReaderProjection | null;
  readonly heldProjectionCheck: ReturnType<typeof newZipReadiness> | null;
  readonly corpusAsOf: string | null;
  readonly freshness: ZipQueueInput["freshness"];
  readonly readinessStatus: ReadinessReadOutcome["kind"] | "UNKNOWN";
  readonly readinessPublishedAt: string | null;
  readonly zipReadiness: ZipRow | null;
  /** State-level gate gaps, explicitly not asserted to be ZIP-specific failures. */
  readonly stateCapabilityGaps: readonly { readonly capabilityId: string; readonly gates: readonly GateCell[] }[];
  readonly gaps: readonly string[];
  readonly sharedRefs: readonly string[];
  readonly completionRequirements: typeof ZIP_COMPLETION_REQUIREMENTS;
  readonly completionVerified: false;
  readonly activation: "NOT_AUTHORIZED";
  readonly nextAutomaticAction: null;
  readonly retryAt: null;
}

export interface SharedZipResearch {
  /** A reference key, NOT a task/obligation ID. Never enqueue this as a second ledger. */
  readonly ref: string;
  readonly kind: "jurisdiction" | "source-corpus" | "candidacy";
  readonly canonicalId: string;
  readonly zipConsumers: readonly string[];
  readonly action: "REUSE_HELD_EVIDENCE_AND_METHODS_BEFORE_ANY_ACQUISITION";
}

export interface PreparedZipQueues {
  readonly contract: typeof ZIP_QUEUE_CONTRACT;
  readonly mode: "PREPARATION_ONLY";
  readonly existingCompletion: readonly PreparedZip[];
  readonly newExpansion: readonly PreparedZip[];
  readonly sharedResearch: readonly SharedZipResearch[];
}

/** Pure projection: no fetch, persistence, dispatch, tier promotion or live expansion. */
export function prepareZipQueues(inputs: readonly ZipQueueInput[]): PreparedZipQueues {
  const seen = new Set<string>();
  const shared = new Map<string, { kind: SharedZipResearch["kind"]; canonicalId: string; zips: Set<string> }>();
  const existingCompletion: PreparedZip[] = [];
  const newExpansion: PreparedZip[] = [];
  for (const input of inputs) {
    if (!/^\d{5}$/.test(input.zip) || !/^[a-z]{2}$/i.test(input.stateCode)) throw new Error("Invalid ZIP/state input");
    if (input.lane !== "existing-completion" && input.lane !== "new-expansion") throw new Error("Invalid preparation lane");
    if (seen.has(input.zip)) throw new Error(`Duplicate ZIP preparation: ${input.zip}`);
    seen.add(input.zip);
    if (input.corpus && input.corpus.universe.stateCode.toLowerCase() !== input.stateCode.toLowerCase()) {
      throw new Error(`Corpus belongs to a different state for ZIP ${input.zip}`);
    }
    const refs = new Set<string>();
    function reuse(kind: SharedZipResearch["kind"], canonicalId: string) {
      const ref = `${kind}:${canonicalId}`;
      refs.add(ref);
      const value = shared.get(ref) ?? { kind, canonicalId, zips: new Set<string>() };
      value.zips.add(input.zip);
      shared.set(ref, value);
    }
    const scope = applicableDivisions({ stateCode: input.stateCode, overlapping: input.overlappingDivisions });
    for (const division of scope.divisions) reuse("jurisdiction", division);
    const projected = input.corpus ? projectOntoZip({
      zip: input.zip, universe: input.corpus.universe, citation: input.corpus.citation, divisions: scope.divisions,
    }) : null;
    if (input.corpus) {
      for (const source of input.corpus.universe.derivedFrom) reuse("source-corpus", source.path);
      for (const candidacy of projected!.candidacies) reuse("candidacy", candidacy.id);
    }
    const readiness = input.readiness;
    const snapshot = readiness?.kind === "HELD" ? readiness.snapshot : null;
    if (snapshot && snapshot.state.toLowerCase() !== input.stateCode.toLowerCase()) {
      throw new Error(`Readiness belongs to a different state for ZIP ${input.zip}`);
    }
    const gaps = ["Full ZIP completion has not been verified against the existing playbook; a tier stamp or held-corpus projection cannot establish it."];
    if (!input.stamp) gaps.push("No stamped ZIP coverage evidence supplied.");
    if (!scope.hadGeometry) gaps.push("ZIP overlap geometry is not held; projection includes the state only and does not establish local applicability.");
    if (!input.corpus) gaps.push("No held candidacy corpus supplied; acquisition coverage is unknown.");
    if (!snapshot) gaps.push(`Readiness ${readiness?.kind ?? "UNKNOWN"}: ${readiness && "detail" in readiness ? readiness.detail : "no trusted readiness snapshot supplied"}.`);
    else if (!snapshot.zips.some((zip) => zip.zip === input.zip)) gaps.push("Trusted state readiness has no row for this ZIP.");
    for (const [name, verdict] of Object.entries(input.freshness)) {
      if (!verdict || verdict.ageDays === null) gaps.push(`${name} freshness is unknown; historical evidence is retained, with current validity unverified.`);
      else if (!verdict.fresh) gaps.push(`${name} evidence is stale under its existing freshness policy; revalidate before relying on it.`);
    }
    const row: PreparedZip = {
      zip: input.zip, stateCode: input.stateCode.toLowerCase(),
      stampedTier: input.stamp?.tier ?? "UNKNOWN", stampedAt: input.stamp?.stampedAt ?? null,
      tierNextStep: input.stamp ? COVERAGE_TIER_NEXT_STEP[input.stamp.tier] : "Establish stamped coverage evidence using the existing coverage process.",
      coverageEvidence: input.stamp?.evidence ?? null,
      unresolvedSpecialDistrictsInCounties: input.stamp?.unresolvedSpecialDistrictsInCounties ?? null,
      geometryHeld: scope.hadGeometry, heldProjection: projected?.projection ?? null,
      heldProjectionCheck: projected ? newZipReadiness(projected.projection) : null,
      corpusAsOf: input.corpus?.universe.generatedOn ?? null, freshness: input.freshness,
      readinessStatus: readiness?.kind ?? "UNKNOWN", readinessPublishedAt: snapshot?.publishedAt ?? null,
      zipReadiness: snapshot?.zips.find((zip) => zip.zip === input.zip) ?? null,
      stateCapabilityGaps: snapshot?.capabilities.map((capability) => ({
        capabilityId: capability.capabilityId,
        gates: capability.gates.filter((gate) => gate.state !== "CURRENT" && gate.state !== "ARGUED_ABSENT"),
      })).filter((capability) => capability.gates.length > 0) ?? [],
      gaps, sharedRefs: [...refs].sort(), completionRequirements: ZIP_COMPLETION_REQUIREMENTS,
      completionVerified: false, activation: "NOT_AUTHORIZED", nextAutomaticAction: null, retryAt: null,
    };
    (input.lane === "existing-completion" ? existingCompletion : newExpansion).push(row);
  }
  return {
    contract: ZIP_QUEUE_CONTRACT, mode: "PREPARATION_ONLY", existingCompletion, newExpansion,
    sharedResearch: [...shared].sort(([a], [b]) => a.localeCompare(b)).map(([ref, value]) => ({
      ref, kind: value.kind, canonicalId: value.canonicalId, zipConsumers: [...value.zips].sort(),
      action: "REUSE_HELD_EVIDENCE_AND_METHODS_BEFORE_ANY_ACQUISITION",
    })),
  };
}
