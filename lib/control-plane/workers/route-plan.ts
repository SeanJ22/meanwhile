import type { AutonomousWorkPlan } from "./autonomous-plan.ts";
import type { ProvidedObligation, RouteDescriptor } from "../scheduler/registry.ts";
import { oneHunterPath } from "./scout-scheduling.ts";

/** Every route plan's capability starts with this, so the runner can tell it from a Send's plan. */
export const ROUTE_PLAN_CAPABILITY_PREFIX = "route-scout:";

/** A plan built here for a provider's paid route, rather than one a provider or a Send wrote. */
export function isRoutePlan(plan: Pick<AutonomousWorkPlan, "capability"> | undefined | null): boolean {
  return plan?.capability.startsWith(ROUTE_PLAN_CAPABILITY_PREFIX) === true;
}

/**
 * CH-23 part 2, behind WTP_ONE_HUNTER_PATH: a route plan only counts as planned work while the switch is on. With it
 * off, a row that already holds one is treated as unplanned, so its paid Scout runs in the round's research path as before.
 */
export function plannedForHunters(plan: AutonomousWorkPlan | undefined, env: NodeJS.ProcessEnv = process.env): plan is AutonomousWorkPlan {
  return plan !== undefined && (!isRoutePlan(plan) || oneHunterPath(env));
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** `AZ` from a state division, or the two-letter prefix of a subject id; `US` when neither names a state. */
function stateOf(record: Pick<ProvidedObligation, "subjectId" | "scopeDivisions">): string {
  for (const division of record.scopeDivisions ?? []) {
    const state = /\/state:([a-z]{2})(?:\/|$)/.exec(division)?.[1];
    if (state) return state.toUpperCase();
  }
  return /^([a-z]{2})[-:]/.exec(record.subjectId)?.[1]?.toUpperCase() ?? "US";
}

/**
 * CH-23 part 2: the work plan for a provider's paid route that no provider planned, so its Scout runs as a coordinator
 * work item with a plan (one hunter path) instead of in the round's separate research path.
 *
 * The plan keeps the row's own record class and subject. A coordinator Scout records its result under the plan's
 * class and subject, so what already reads Scout results by class and subject (the promotion pipeline, the
 * campaign-site chain) reads these the same way. The Scout is briefed from the route itself: what it is, why no
 * plain client opens it, and its address when it has one. No address is invented: a target that is not an https URL
 * is described, never seeded. No reader door is named here; a provider that holds one plans the route itself (CH-22).
 */
export function routeWorkPlan(input: { readonly providerId: string; readonly record: ProvidedObligation; readonly route: RouteDescriptor }): AutonomousWorkPlan | null {
  const { providerId, record, route } = input;
  if (route.executorClass !== "BOUNDED_MODEL_WORKER" || record.autonomousPlans?.[route.routeId]) return null;
  const open = route.open;
  const address = "url" in open ? open.url : open.kind === "NOT_MACHINE_EXECUTABLE" ? open.target : null;
  const seed = address === null ? null : httpsUrl(address);
  const why = open.kind === "NOT_MACHINE_EXECUTABLE" ? ` Why no plain client opens it: ${open.reason}` : "";
  const state = stateOf(record);
  return {
    version: 1, capability: `${ROUTE_PLAN_CAPABILITY_PREFIX}${providerId}`, jurisdiction: state,
    sourceRegistryReferences: [record.subjectId, route.routeId], seedUrls: seed ? [seed] : [],
    sources: [], acquisition: [], engineering: [], auditScope: "SOURCE_UNIVERSE",
    contract: {
      schemaVersion: 2, recordClass: record.recordClass, subjectId: record.subjectId,
      requiredFields: ["value", "sourceUrl", "sourceSentence"],
      identity: { namespace: `${record.subjectId}:${route.routeId}`, keyFields: ["value", "sourceUrl"] },
      jurisdiction: { country: "US", state, canonicalId: record.subjectId },
      completenessScope: `${route.label}.${address && !seed ? ` Target: ${address}.` : ""}${why} ` +
        "Take each value from a saved official page with its exact sentence; this route's work does not discharge the record's other routes or establish publisher absence.",
      expectedSourceDate: null, methodVersion: 0,
      sourceScope: { sourceId: `unobserved:${route.routeId}`, publisher: record.subjectId, routeIds: [route.routeId], canonicalUrls: [], observationArtifactIds: [] },
      extraction: { format: "UNSUPPORTED", mediaType: "unobserved", fields: {}, reason: "Discover actual source bytes, applicability and an executable mapping." },
      verification: { required: false, authorities: [] },
    },
  };
}
