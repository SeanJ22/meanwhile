/** The inherited route floor, computed before any Attempt runs, so a worker cannot silently forget a known route. */

import type { MethodRoute } from "../method/knowledge.ts";
import {
  gradeApplicability,
  type ApplicabilityDimension,
  type ApplicabilityGrade,
  type Jurisdiction,
} from "../method/portability.ts";
import { createRouteTask, type RouteTask } from "./route-task.ts";
import type { WorkItem } from "./work-item.ts";
import { withRouteTasks } from "./work-item.ts";

export const FLOOR_ORIGINS = [
  "METHOD_PROJECTION",
  "ADAPTER_DECLARED",
] as const;
export type FloorOrigin = (typeof FLOOR_ORIGINS)[number];

/** A speculative method hypothesis is not a known route: only REQUIRED ids enter `CompletionContract.inheritedRouteFloor`. */
export const FLOOR_OBLIGATIONS = ["REQUIRED", "EXPLORATORY"] as const;
export type FloorObligation = (typeof FLOOR_OBLIGATIONS)[number];

export const FLOOR_PROOFS = [
  /** The adapter declares this exact surface for THIS publisher. */
  "ADAPTER_DECLARED",
  /** `gradeApplicability` returned PROVEN: a typed dimension matched. */
  "PORTABILITY_PROVEN",
  /** Offered on unproven applicability. This is a hypothesis, not a known route. */
  "APPLICABILITY_UNPROVEN",
] as const;
export type FloorProof = (typeof FLOOR_PROOFS)[number];

export interface FloorRoute {
  readonly routeId: string;
  readonly label: string;
  readonly origins: readonly FloorOrigin[];
  /** True when the store offered this route on unknown portability: still owed a disposition, never claimed as known to apply. */
  readonly speculative: boolean;
  readonly target: string;
  /** Does omission of this route refuse the close BY NAME? */
  readonly obligation: FloorObligation;
  readonly proof: FloorProof;
  readonly grade: ApplicabilityGrade;
  readonly matchedDimensions: readonly ApplicabilityDimension[];
  readonly unstatedDimensions: readonly ApplicabilityDimension[];
  readonly mismatchedDimensions: readonly ApplicabilityDimension[];
  readonly matchedFields: readonly string[];
}

/** A route typed applicability EXCLUDES. Counted and named, never silently absent. */
export interface ExcludedRoute {
  readonly routeId: string;
  readonly reason: string;
}

export interface RouteFloor {
  readonly routes: readonly FloorRoute[];
  /** Required ids only, in the shape `CompletionContract.inheritedRouteFloor` wants. `allRouteIds` is the union. */
  readonly routeIds: readonly string[];
  /** Routes whose omission refuses the close by name. */
  readonly required: readonly FloorRoute[];
  /** Method hypotheses to test here. Owed a disposition; never a known route. */
  readonly exploratory: readonly FloorRoute[];
  readonly exploratoryRouteIds: readonly string[];
  /** Required ∪ exploratory. Every id the preflight materialises a task for. */
  readonly allRouteIds: readonly string[];
  /** Routes typed applicability excludes for this jurisdiction, with the reason. */
  readonly excluded: readonly ExcludedRoute[];
  /** The method version the floor was computed against. Pinned for replay. */
  readonly methodVersion: number;
  /** Store routes whose prose nobody classified: counted, never inherited. */
  readonly legacyUnclassifiedCount: number;
  readonly jurisdiction: Jurisdiction;
}

export interface AdapterRouteDeclaration {
  /** The adapter's own route identifier, e.g. "INSITE_CALENDAR_GRID". */
  readonly routeId: string;
  readonly label: string;
  readonly target: string;
}

/** The floor needs route applicability, not the country's observation or claim history. */
export type FloorMethodRoute = Pick<MethodRoute, "id" | "title" | "fields" | "applicability" | "retiredOn"> & {
  readonly claims?: readonly unknown[];
};
export interface FloorMethodSource { readonly version: number; readonly routes: Iterable<FloorMethodRoute> }
export interface RouteFloorInput {
  readonly knowledge: FloorMethodSource;
  jurisdiction: Jurisdiction;
  fields: readonly string[];
  adapterRoutes: readonly AdapterRouteDeclaration[];
}
export type AuditRouteFloor = Pick<RouteFloor, "routes" | "methodVersion">;

/** An empty `fields` list means no narrowing, the widest reading. */
export function computeRouteFloor(input: RouteFloorInput): RouteFloor {
  return foldRouteFloor(input, true);
}
/** Audit workers receive only their place's route expectations, not country exclusion diagnostics. */
export function computeAuditRouteFloor(input: RouteFloorInput): AuditRouteFloor {
  return foldRouteFloor(input, false);
}
function foldRouteFloor(input: RouteFloorInput, reporting: true): RouteFloor;
function foldRouteFloor(input: RouteFloorInput, reporting: false): AuditRouteFloor;
function foldRouteFloor(input: RouteFloorInput, reporting: boolean): RouteFloor | AuditRouteFloor {
  const byId = new Map<string, FloorRoute>();
  const excluded: ExcludedRoute[] = [];
  let legacyUnclassifiedCount = 0;
  for (const id of input.knowledge.routes) {
    if (id.retiredOn) continue;
    const verdict = gradeApplicability(id.applicability, input.jurisdiction);
    if (verdict.grade === "EXCLUDED") {
      if (reporting) excluded.push({ routeId: id.id, reason: verdict.reason });
      continue;
    }
    if (!id.claims?.length) legacyUnclassifiedCount++;
    const matchedFields = id.fields.filter((f) => input.fields.includes(f));
    if (input.fields.length > 0 && matchedFields.length === 0) continue;

    const proven = verdict.grade === "PROVEN";

    byId.set(id.id, {
      routeId: id.id,
      label: id.title,
      origins: ["METHOD_PROJECTION"],
      speculative: !proven,
      target: input.jurisdiction.publisher ?? input.jurisdiction.state,
      obligation: proven ? "REQUIRED" : "EXPLORATORY",
      proof: proven ? "PORTABILITY_PROVEN" : "APPLICABILITY_UNPROVEN",
      grade: verdict.grade,
      matchedDimensions: verdict.matchedDimensions,
      unstatedDimensions: verdict.unstatedDimensions,
      mismatchedDimensions: verdict.mismatchedDimensions,
      matchedFields,
    });
  }

  for (const declared of input.adapterRoutes) {
    const existing = byId.get(declared.routeId);
    /* A route the adapter declares for this publisher is REQUIRED whatever the store says; the adapter only ever promotes. */
    if (existing) {
      byId.set(declared.routeId, {
        ...existing,
        origins: [...existing.origins, "ADAPTER_DECLARED"],
        speculative: false,
        target: declared.target,
        obligation: "REQUIRED",
        proof: "ADAPTER_DECLARED",
      });
      continue;
    }
    byId.set(declared.routeId, {
      routeId: declared.routeId,
      label: declared.label,
      origins: ["ADAPTER_DECLARED"],
      speculative: false,
      target: declared.target,
      obligation: "REQUIRED",
      proof: "ADAPTER_DECLARED",
      // The adapter is not the method store and states no portability class.
      grade: "PROVEN",
      matchedDimensions: ["publisher"],
      unstatedDimensions: [],
      mismatchedDimensions: [],
      matchedFields: [...input.fields],
    });
  }

  const routes = [...byId.values()];
  if (!reporting) return { routes, methodVersion: input.knowledge.version };
  const required = routes.filter((r) => r.obligation === "REQUIRED");
  const exploratory = routes.filter((r) => r.obligation === "EXPLORATORY");

  return {
    routes,
    routeIds: required.map((r) => r.routeId),
    required,
    exploratory,
    exploratoryRouteIds: exploratory.map((r) => r.routeId),
    allRouteIds: routes.map((r) => r.routeId),
    excluded,
    methodVersion: input.knowledge.version,
    legacyUnclassifiedCount,
    jurisdiction: input.jurisdiction,
  };
}

/** After preflight an undisposed route is a missing row, which `evaluateCompletion` refuses on. */
export function materializeFloor(
  item: WorkItem,
  floor: RouteFloor,
  now: string,
): { item: WorkItem; routeTasks: RouteTask[]; explorationTasks: RouteTask[] } {
  const task = (r: FloorRoute): RouteTask =>
    createRouteTask({
      workItemId: item.id,
      routeId: r.routeId,
      routeLabel: r.label,
      target: r.target,
      /* `inherited` means "came from the preflight floor", not "required"; exploratory offers set it too. */
      inherited: true,
      now,
    });

  const routeTasks = floor.required.map(task);
  const explorationTasks = floor.exploratory.map(task);

  const bound: WorkItem = {
    /* Every task is bound to the item, so the scheduler walks the exploration queue by construction. */
    ...withRouteTasks(item, [...routeTasks, ...explorationTasks].map((t) => t.id)),
    /* Only the required ids reach the contract; exploratory tasks hold the obligation open through ROUTE_TASK_STILL_OUTSTANDING. */
    contract: { ...item.contract, inheritedRouteFloor: floor.routeIds },
  };

  return { item: bound, routeTasks, explorationTasks };
}

export const FLOOR_INTEGRITY_FAILURES = [
  /** An adapter-declared surface is absent from the floor entirely. */
  "ADAPTER_ROUTE_MISSING_FROM_FLOOR",
  /** It is on the floor but was not carried into the completion contract. */
  "ADAPTER_ROUTE_NOT_IN_CONTRACT",
  /** It is on the floor but was filed as an experiment rather than as required. */
  "ADAPTER_ROUTE_DEMOTED_TO_EXPLORATORY",
  /** An unproven hypothesis was carried into the contract as a known route. */
  "SPECULATIVE_ROUTE_IN_CONTRACT",
  /** A required route has no materialised RouteTask to be disposed on. */
  "REQUIRED_ROUTE_WITHOUT_TASK",
] as const;
export type FloorIntegrityFailure = (typeof FLOOR_INTEGRITY_FAILURES)[number];

export interface FloorIntegrityFinding {
  readonly failure: FloorIntegrityFailure;
  readonly subject: string;
  readonly detail: string;
}

/** Catches a required adapter-declared route that was dropped or reclassified as an experiment. */
export function auditFloorIntegrity(input: {
  floor: RouteFloor;
  adapterRoutes: readonly AdapterRouteDeclaration[];
  item: WorkItem;
  routeTasks: readonly RouteTask[];
}): FloorIntegrityFinding[] {
  const findings: FloorIntegrityFinding[] = [];
  const onFloor = new Map(input.floor.routes.map((r) => [r.routeId, r]));
  const contract = new Set(input.item.contract.inheritedRouteFloor);
  const tasked = new Set(input.routeTasks.map((t) => t.routeId));

  for (const declared of input.adapterRoutes) {
    const route = onFloor.get(declared.routeId);
    if (!route) {
      findings.push({
        failure: "ADAPTER_ROUTE_MISSING_FROM_FLOOR",
        subject: declared.routeId,
        detail:
          `${declared.label} is a first-party surface this publisher serves and it is not on ` +
          "the floor at all. No other route's success can make it unowed.",
      });
      continue;
    }
    if (route.obligation !== "REQUIRED") {
      findings.push({
        failure: "ADAPTER_ROUTE_DEMOTED_TO_EXPLORATORY",
        subject: declared.routeId,
        detail:
          `${declared.label} is declared by the adapter for this publisher and is filed as ` +
          `${route.obligation}. "Speculative" is a statement about unproven techniques and may ` +
          "never be applied to a surface we know this body serves.",
      });
    }
    if (!contract.has(declared.routeId)) {
      findings.push({
        failure: "ADAPTER_ROUTE_NOT_IN_CONTRACT",
        subject: declared.routeId,
        detail:
          `${declared.label} is on the floor but absent from the completion contract, so ` +
          "omitting it would not refuse the close. This is the MTG-13 shape exactly.",
      });
    }
  }

  for (const route of input.floor.exploratory) {
    if (contract.has(route.routeId)) {
      findings.push({
        failure: "SPECULATIVE_ROUTE_IN_CONTRACT",
        subject: route.routeId,
        detail:
          `${route.routeId} is offered on unproven applicability (${route.grade}) and is in the ` +
          "completion contract, whose refusal asserts the route IS applicable to this subject. " +
          "A hypothesis may not be refused against as though it were a known route.",
      });
    }
  }

  for (const route of input.floor.required) {
    if (!tasked.has(route.routeId)) {
      findings.push({
        failure: "REQUIRED_ROUTE_WITHOUT_TASK",
        subject: route.routeId,
        detail:
          `${route.routeId} is required and no RouteTask was materialised for it, so there is ` +
          "nothing a worker can dispose and nothing the evaluator can find missing.",
      });
    }
  }

  return findings;
}

export const EXPLORATION_STATES = [
  "WALKED",
  /** The executor could not walk it here yet: a fact about our capability, never the publisher. Leaves the RouteTask outstanding. */
  "UNTESTED",
] as const;
export type ExplorationState = (typeof EXPLORATION_STATES)[number];

export interface ExplorationOutcome {
  readonly routeId: string;
  readonly routeTaskId: string;
  readonly state: ExplorationState;
  /** Present when WALKED. The disposition the executor reached. */
  readonly disposition: string | null;
  /** Always present. Why it walked, or the named reason it could not. */
  readonly reason: string;
}

/**
 * An executor for one experiment. Returns the disposition it reached, or `null`
 * WITH A REASON when it cannot walk this technique against this target.
 */
export type ExplorationExecutor = (
  route: FloorRoute,
  task: RouteTask,
) => Promise<{ disposition: string | null; reason: string }>;

export async function runExplorationQueue(
  floor: RouteFloor,
  tasks: readonly RouteTask[],
  execute: ExplorationExecutor,
): Promise<ExplorationOutcome[]> {
  const byRouteId = new Map(tasks.map((t) => [t.routeId, t]));
  const outcomes: ExplorationOutcome[] = [];

  for (const route of floor.exploratory) {
    const task = byRouteId.get(route.routeId);
    if (!task) continue;
    const result = await execute(route, task);
    outcomes.push({
      routeId: route.routeId,
      routeTaskId: task.id,
      state: result.disposition === null ? "UNTESTED" : "WALKED",
      disposition: result.disposition,
      reason: result.reason,
    });
  }

  return outcomes;
}

/** Prints the floor and the unclassified population, so a small floor does not read as an exhausted store. */
export function describeFloor(floor: RouteFloor): string {
  const line = (r: FloorRoute): string => {
    const dims =
      r.matchedDimensions.length > 0
        ? `matched ${r.matchedDimensions.join("+")}`
        : "matched NOTHING";
    const unstated =
      r.unstatedDimensions.length > 0 ? `; unstated ${r.unstatedDimensions.join("+")}` : "";
    const mismatched =
      r.mismatchedDimensions.length > 0
        ? `; evidence DISAGREES on ${r.mismatchedDimensions.join("+")}`
        : "";
    return (
      `  ${r.routeId}  (${r.origins.join("+")}) [${r.proof}]\n` +
      `      ${r.label} -> ${r.target}\n` +
      `      ${dims}${unstated}${mismatched}` +
      (r.matchedFields.length > 0 ? `; in scope on field ${r.matchedFields.join("+")}` : "")
    );
  };

  return [
    `INHERITED ROUTE FLOOR — ${floor.routes.length} route(s), method version ${floor.methodVersion}`,
    "",
    `MANDATORY — ${floor.required.length} route(s). Omission refuses the close BY NAME.`,
    ...floor.required.map(line),
    "",
    `SPECULATIVE EXPERIMENTS — ${floor.exploratory.length} route(s). Applicability NOT proven here.`,
    "  Each is owed a disposition and holds the obligation open until it has one.",
    "  None of them may satisfy, or excuse, a mandatory route.",
    ...floor.exploratory.map(line),
    "",
    `  typed applicability EXCLUDED ${floor.excluded.length} route(s) from this jurisdiction`,
    ...floor.excluded.map((e) => `      ${e.routeId}: ${e.reason}`),
    `  legacy entries whose prose is unclassified and therefore NOT inherited: ${floor.legacyUnclassifiedCount}`,
  ].join("\n");
}
