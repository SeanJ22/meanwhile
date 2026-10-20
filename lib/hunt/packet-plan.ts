import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import { OWNER_DISPATCH, type FreshnessObligation } from "../control-plane/scheduler/obligation.ts";
import type { RouteDescriptor } from "../control-plane/scheduler/registry.ts";
import { HUNT_PACKET_CAPABILITY, HUNT_PACKET_RECORD_CLASS, HUNT_PACKET_ROUTE_ID, huntPacketObligationId } from "./packet.ts";

export function stateOfDivision(divisionId: string): string {
  return (/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(divisionId)?.[1]
    ?? /^government:US-([a-z]{2}):/i.exec(divisionId)?.[1])?.toUpperCase() ?? "US";
}

export function isHuntPacketPlan(plan: Pick<AutonomousWorkPlan, "capability"> | undefined | null): boolean {
  return plan?.capability === HUNT_PACKET_CAPABILITY;
}

export function huntPacketPlan(governmentId: string): AutonomousWorkPlan {
  const state = stateOfDivision(governmentId);
  return {
    version: 1, capability: HUNT_PACKET_CAPABILITY, jurisdiction: state,
    sourceRegistryReferences: [governmentId], seedUrls: [], sources: [], acquisition: [], auditScope: "SOURCE_UNIVERSE",
    contract: {
      schemaVersion: 2, recordClass: HUNT_PACKET_RECORD_CLASS, subjectId: governmentId,
      requiredFields: ["subjectId", "field", "value", "sourceUrl", "sentence"],
      identity: { namespace: huntPacketObligationId(governmentId), keyFields: ["subjectId", "field"] },
      jurisdiction: { country: "US", state, canonicalId: governmentId },
      completenessScope: "Every open blank this government owes; each fact goes into the Box as it is found and is checked there.",
      expectedSourceDate: null, methodVersion: 0,
      sourceScope: { sourceId: `hunt:${governmentId}`, publisher: governmentId, routeIds: [HUNT_PACKET_ROUTE_ID], canonicalUrls: [], observationArtifactIds: [] },
      extraction: { format: "UNSUPPORTED", mediaType: "unobserved", reason: "Facts are reported one at a time into the Box.", fields: {} },
      verification: { required: false, authorities: [] },
    },
  };
}

export const HUNT_PACKET_ROUTE: RouteDescriptor = {
  routeId: HUNT_PACKET_ROUTE_ID,
  label: "Hunt every open blank for this government",
  executorClass: "BOUNDED_MODEL_WORKER",
  executorReason: "the blanks are the facts no plain-code source has filled; a hunter searches for them and reports each one into the Box",
  open: { kind: "NOT_MACHINE_EXECUTABLE", target: "the government's open blanks", reason: "a hunter finds where each blank is published" },
  citation: "the State Run Checklist's owed list for this government",
};

export function huntPacketObligation(governmentId: string): FreshnessObligation {
  return {
    id: huntPacketObligationId(governmentId),
    recordClass: HUNT_PACKET_RECORD_CLASS,
    subjectId: governmentId,
    routeId: HUNT_PACKET_ROUTE_ID,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    materializedBy: OWNER_DISPATCH,
    autonomousPlan: huntPacketPlan(governmentId),
  };
}
