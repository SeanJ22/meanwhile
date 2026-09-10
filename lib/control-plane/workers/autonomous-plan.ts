import type { CivicExtractionContract } from "./types.ts";
import type { AcquirerTaskSpec, DetectiveTaskSpec, ObservedResearchRoute } from "./research-types.ts";
import type { EngineeringTaskSpec } from "./engineering-types.ts";
import { scheduleObligation, type FreshnessObligation } from "../scheduler/obligation.ts";
import type { AcquirerResult } from "./research-types.ts";

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
