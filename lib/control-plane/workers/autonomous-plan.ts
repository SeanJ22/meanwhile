import type { CivicExtractionContract } from "./types.ts";
import type { AcquirerTaskSpec, DetectiveTaskSpec, ObservedResearchRoute } from "./research-types.ts";
import type { EngineeringTaskSpec } from "./engineering-types.ts";
import { scheduleObligation, type FreshnessObligation } from "../scheduler/obligation.ts";
import type { AcquirerResult } from "./research-types.ts";
import type { Jurisdiction, JurisdictionSource } from "../../hunt/jurisdiction-universe.ts";

/** Initial instructions for an owner-requested family. Registry addresses are
 * leads, never invented observations. An evidence-backed repair must supply
 * the extraction mapping and independent authorities before parsing can pass. */
export function jurisdictionDiscoveryPlan(jurisdiction: Jurisdiction, source: JurisdictionSource, routeId: string, bodyId: string | null = jurisdiction.bodyId ?? null): AutonomousWorkPlan | null {
  if (source.recordClass === "MEETINGS") return null; // Existing meeting discovery/publishing owns this path.
  const spec = source.recordClass === "OFFICEHOLDERS"
    ? { recordClass: "OFFICIAL_ROSTER", fields: ["name", "office"] }
    : source.recordClass === "BALLOT_AND_CANDIDATES"
      ? { recordClass: "CANDIDATE_FILING_DOCUMENT", fields: ["candidateName", "office"] }
      : { recordClass: "CAMPAIGN_FINANCE_FILING", fields: ["committeeName", "filingPeriod", "documentUrl"] };
  const seedUrls = [...new Set([source.url, jurisdiction.ownWebAddress].filter((url): url is string => {
    if (!url) return false;
    try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; }
  }))];
  return {
    version: 1, capability: source.recordClass === "OFFICEHOLDERS" ? "officials/offices" : source.recordClass, jurisdiction: jurisdiction.id.split(":")[0].toUpperCase(),
    sourceRegistryReferences: [jurisdiction.id, routeId], seedUrls, sources: [], acquisition: [], detective: [], engineering: [], auditScope: "SOURCE_UNIVERSE",
    ...(source.recordClass === "OFFICEHOLDERS" && bodyId ? { publication: { contractId: "registry-runtime-bindings" as const, bodyId } } : {}),
    contract: {
      schemaVersion: 2, recordClass: spec.recordClass, subjectId: jurisdiction.id,
      requiredFields: spec.fields, identity: { namespace: `${jurisdiction.id}:${source.recordClass}`, keyFields: spec.fields },
      jurisdiction: { country: "US", state: jurisdiction.id.split(":")[0].toUpperCase(), canonicalId: jurisdiction.id },
      completenessScope: `${source.recordClass} for ${jurisdiction.name}. ${source.owed ?? source.authorityBasis} This initial source contract does not discharge downstream information families or establish publisher absence.`,
      // Zero means an unbound instruction template, never an extraction result.
      // The standing runtime binds its actual inherited method-store version
      // before consuming any repair or dispatching a worker.
      expectedSourceDate: null, methodVersion: 0,
      sourceScope: { sourceId: `unobserved:${routeId}`, publisher: source.authority, routeIds: [routeId], canonicalUrls: [], observationArtifactIds: [] },
      extraction: { format: "UNSUPPORTED", mediaType: "unobserved", fields: {}, reason: "Discover actual source bytes, applicability, an executable mapping and independent verification authorities." },
      verification: { required: true, authorities: [] },
    },
  };
}

/**
 * These legacy worker contracts acquire the same meeting event feeds now
 * owned by permanent SOURCE_WIRING-derived meeting-partition contracts. They
 * remain readable as immutable engineering evidence, but the standing runtime
 * may never schedule or dispatch another acquisition for them.
 */
export const RETIRED_ROUTINE_MEETING_ACQUISITION_CLASSES = [
  "LEGISTAR_EVENTS",
  "CIVICCLERK_EVENTS",
] as const;

export function isRetiredRoutineMeetingAcquisition(
  contract: CivicExtractionContract,
): boolean {
  return contract.schemaVersion === 1 &&
    (RETIRED_ROUTINE_MEETING_ACQUISITION_CLASSES as readonly string[]).includes(contract.recordClass);
}

/** Work instructions, never evidence or a readiness label. Stored with the owed WorkItem. */
export interface AutonomousWorkPlan {
  readonly ownerInstructions?: readonly string[];
  /** Existing reader door selected by the system's exact body join, never by a model. */
  readonly publication?: { readonly contractId: "registry-runtime-bindings"; readonly bodyId: string };
  readonly freshness?: Pick<FreshnessObligation,"readerImpactAt"|"observedChangeRateHours"|"declaredCycleHours">;
  readonly version: 1;
  readonly contract: CivicExtractionContract;
  readonly capability: string;
  readonly jurisdiction: string;
  readonly sourceRegistryReferences: readonly string[];
  readonly seedUrls: readonly string[];
  readonly sources: readonly ObservedResearchRoute[];
  readonly acquisition: readonly AcquirerTaskSpec[];
  readonly detective: readonly DetectiveTaskSpec[];
  readonly engineering: readonly EngineeringTaskSpec[];
  readonly auditScope: "CAPTURED_ARTIFACT" | "SOURCE_UNIVERSE";
}

/** A content-addressed artifact keeps its first retrieval stamp; a later successful
 * network rung records a real re-observation without rewriting that immutable identity. */
export function scheduleAutonomousAcquisition(plan:AutonomousWorkPlan,result:AcquirerResult,now:string) {
  const captured=result.artifacts.filter(artifact=>artifact.completeness==="COMPLETE");
  const timestamps=[...captured.map(artifact=>artifact.retrievedAt),...result.walk.filter(step=>step.rung===result.source.retrieval&&step.transport==="REACHABLE"&&step.outcome==="WALKED_AND_FOUND"&&captured.some(artifact=>step.artifactIds.includes(artifact.artifactId))).map(step=>step.at)];
  const lastWorkedAt=timestamps.filter(value=>Number.isFinite(Date.parse(value))).sort().at(-1)??null;
  return scheduleObligation({id:`autonomous-source:${result.source.subjectId}:${result.source.id}`,subjectId:result.source.subjectId,recordClass:plan.contract.recordClass,
    routeId:result.source.id,active:true,readerImpactAt:plan.freshness?.readerImpactAt??null,observedChangeRateHours:plan.freshness?.observedChangeRateHours??null,
    declaredCycleHours:plan.freshness?.declaredCycleHours??null,lastWorkedAt},Date.parse(now));
}
