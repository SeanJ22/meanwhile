/**
 * PREFLIGHT — the inherited route floor, COMPUTED and never typed.
 *
 * This is the bridge that turns "a worker cannot silently forget a known API"
 * from a sentence into a mechanism. Before any Attempt runs, the control plane
 * asks two authorities what routes are already known for this subject, and the
 * answer becomes the WorkItem's completion contract. A worker never supplies
 * its own floor, because a worker that forgot a route would forget it here too.
 *
 * THE TWO AUTHORITIES, and why it takes both:
 *
 *   1. `lib/method` — the project's cumulative, cross-jurisdiction route
 *      knowledge, reached through `projectMethodFor`. RULING 195 makes the
 *      typed projection the ONLY inheritance interface, so this module calls it
 *      and never touches `applicableRoutesUnprojected` (a repo sweep in
 *      `tests/method-projection.test.ts` enforces that).
 *
 *   2. The SOURCE ADAPTER's own declared first-party surfaces. The method store
 *      knows portable techniques ("a body publishes its schedule separately
 *      from its agendas"); the adapter knows the eight concrete Legistar/InSite
 *      routes for this tenant. Neither is a superset of the other, and a floor
 *      built from only one of them is how fourteen Pima sittings became three.
 *
 * The union is the floor. That is the same rule the Pima correction already
 * established for INSTANCES — an instance published by any materially distinct
 * first-party route is owed — applied one level up, to the routes themselves.
 */

import type { MethodKnowledge } from "../method/knowledge.ts";
import type { Jurisdiction } from "../method/portability.ts";
import { projectMethodFor, type MethodProjection } from "../method/projection.ts";
import { createRouteTask, type RouteTask } from "./route-task.ts";
import type { WorkItem } from "./work-item.ts";
import { withRouteTasks } from "./work-item.ts";

/** Where a route in the floor came from. Both are authority; neither is a guess. */
export const FLOOR_ORIGINS = [
  /** The typed current-claim projection of the method store, for this jurisdiction. */
  "METHOD_PROJECTION",
  /** A source adapter's declared first-party surfaces for this subject's publisher. */
  "ADAPTER_DECLARED",
] as const;
export type FloorOrigin = (typeof FLOOR_ORIGINS)[number];

export interface FloorRoute {
  readonly routeId: string;
  readonly label: string;
  readonly origins: readonly FloorOrigin[];
  /**
   * True when the method store OFFERED this route on UNKNOWN portability
   * rather than on evidence that it fits here. It is still owed a disposition —
   * an offer that is never walked teaches nothing — but a report may not claim
   * the route was known to apply.
   */
  readonly speculative: boolean;
  /** Which target this route is walked against: a host, a tenant, an endpoint family. */
  readonly target: string;
}

export interface RouteFloor {
  readonly routes: readonly FloorRoute[];
  /** Route ids only, in the shape `CompletionContract.inheritedRouteFloor` wants. */
  readonly routeIds: readonly string[];
  /** The method version the floor was computed against. Pinned for replay. */
  readonly methodVersion: number;
  /**
   * Routes the method store knows about but whose substantive prose nobody has
   * classified. They are COUNTED, never inherited as conclusions. Reported so a
   * floor of 8 out of a store of 116 does not read as a store of 8.
   */
  readonly legacyUnclassifiedCount: number;
  readonly jurisdiction: Jurisdiction;
}

export interface AdapterRouteDeclaration {
  /** The adapter's own route identifier, e.g. "INSITE_CALENDAR_GRID". */
  readonly routeId: string;
  readonly label: string;
  readonly target: string;
}

/**
 * Compute the floor.
 *
 * `fields` narrows the method projection to routes that bear on what this
 * obligation actually owes — a route about campaign-finance filings is not part
 * of a meetings floor. An EMPTY `fields` list means no narrowing, which is
 * deliberately the widest reading: over-including a route costs one disposition,
 * while under-including one costs a fact.
 */
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
    if (input.fields.length > 0 && !id.fields.some((f) => input.fields.includes(f))) continue;
    byId.set(id.id, {
      routeId: id.id,
      label: id.title,
      origins: ["METHOD_PROJECTION"],
      speculative: id.speculative,
      target: input.jurisdiction.publisher ?? input.jurisdiction.state,
    });
  }

  for (const declared of input.adapterRoutes) {
    const existing = byId.get(declared.routeId);
    if (existing) {
      byId.set(declared.routeId, {
        ...existing,
        origins: [...existing.origins, "ADAPTER_DECLARED"],
        // A route the adapter declares for THIS publisher is not speculative
        // here, whatever the method store's portability says.
        speculative: false,
        target: declared.target,
      });
      continue;
    }
    byId.set(declared.routeId, {
      routeId: declared.routeId,
      label: declared.label,
      origins: ["ADAPTER_DECLARED"],
      speculative: false,
      target: declared.target,
    });
  }

  const routes = [...byId.values()];
  return {
    routes,
    routeIds: routes.map((r) => r.routeId),
    methodVersion: input.knowledge.version,
    legacyUnclassifiedCount: projection.routes.filter((r) => r.legacyUnclassified).length,
    jurisdiction: input.jurisdiction,
  };
}

/**
 * Materialise a RouteTask for every route in the floor and bind them to the
 * WorkItem's contract.
 *
 * This is the step that makes forgetting impossible rather than merely
 * discouraged: after preflight, an undisposed route is a MISSING ROW, and a
 * missing row is what `evaluateCompletion` refuses on. There is no path where a
 * worker "just doesn't mention" a route.
 */
export function materializeFloor(
  item: WorkItem,
  floor: RouteFloor,
  now: string,
): { item: WorkItem; routeTasks: RouteTask[] } {
  const routeTasks = floor.routes.map((r) =>
    createRouteTask({
      workItemId: item.id,
      routeId: r.routeId,
      routeLabel: r.label,
      target: r.target,
      inherited: true,
      now,
    }),
  );

  const bound: WorkItem = {
    ...withRouteTasks(item, routeTasks.map((t) => t.id)),
    contract: { ...item.contract, inheritedRouteFloor: floor.routeIds },
  };

  return { item: bound, routeTasks };
}

/**
 * What a preflight report says out loud.
 *
 * Deliberately prints the floor AND the unclassified population. A session that
 * sees "8 routes inherited" without "112 entries hold prose nobody classified"
 * would reasonably believe the store had been exhausted.
 */
export function describeFloor(floor: RouteFloor): string {
  const lines = floor.routes.map((r) => {
    const origins = r.origins.join("+");
    const spec = r.speculative ? " [SPECULATIVE — offered on UNKNOWN portability]" : "";
    return `  ${r.routeId}  (${origins})${spec}\n      ${r.label} -> ${r.target}`;
  });
  return [
    `INHERITED ROUTE FLOOR — ${floor.routes.length} route(s), method version ${floor.methodVersion}`,
    ...lines,
    `  legacy entries whose prose is unclassified and therefore NOT inherited: ${floor.legacyUnclassifiedCount}`,
  ].join("\n");
}
