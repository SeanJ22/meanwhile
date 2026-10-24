/** The inherited route floor, computed before any Attempt runs, so a worker cannot silently forget a known route. */

import type { MethodKnowledge } from "../method/knowledge.ts";
import {
  gradeApplicability,
  type ApplicabilityDimension,
  type ApplicabilityGrade,
  type Jurisdiction,
} from "../method/portability.ts";
import { projectMethodFor, type MethodProjection } from "../method/projection.ts";
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

/** An empty `fields` list means no narrowing, the widest reading. */
export function computeRouteFloor(input: {
  knowledge: MethodKnowledge;
  jurisdiction: Jurisdiction;
  fields: readonly string[];
  adapterRoutes: readonly AdapterRouteDeclaration[];
}): RouteFloor {
  const projection: MethodProjection = projectMethodFor(input.knowledge, input.jurisdiction);
  const byId = new Map<string, FloorRoute>();

  for (const route of projection.routes) {
    const id = route.identity;
    const matchedFields = id.fields.filter((f) => input.fields.includes(f));
    if (input.fields.length > 0 && matchedFields.length === 0) continue;

    const verdict = gradeApplicability(
      {
        portability: id.portability,
        states: id.states,
        governmentTypes: id.governmentTypes,
        platforms: id.platforms,
        publishers: id.publishers,
        note: "",
      },
      input.jurisdiction,
    );
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
  const required = routes.filter((r) => r.obligation === "REQUIRED");
  const exploratory = routes.filter((r) => r.obligation === "EXPLORATORY");

  /* A reporting read only: it makes no inheritance decision. */
  const excluded: ExcludedRoute[] = [];
  for (const r of input.knowledge.routes) {
    if (r.retiredOn) continue;
    const v = gradeApplicability(r.applicability, input.jurisdiction);
    if (v.grade === "EXCLUDED") excluded.push({ routeId: r.id, reason: v.reason });
  }

  return {
    routes,
    routeIds: required.map((r) => r.routeId),
    required,
    exploratory,
    exploratoryRouteIds: exploratory.map((r) => r.routeId),
    allRouteIds: routes.map((r) => r.routeId),
    excluded,
    methodVersion: input.knowledge.version,
    legacyUnclassifiedCount: projection.routes.filter((r) => r.legacyUnclassified).length,
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
