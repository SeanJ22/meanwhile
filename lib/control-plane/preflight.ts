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

/** Where a route in the floor came from. Both are authority; neither is a guess. */
export const FLOOR_ORIGINS = [
  /** The typed current-claim projection of the method store, for this jurisdiction. */
  "METHOD_PROJECTION",
  /** A source adapter's declared first-party surfaces for this subject's publisher. */
  "ADAPTER_DECLARED",
] as const;
export type FloorOrigin = (typeof FLOOR_ORIGINS)[number];

/**
 * **A SPECULATIVE METHOD HYPOTHESIS IS NOT A KNOWN ROUTE.** (2026-08-29.)
 *
 * The floor used to be one list, and every id in it entered
 * `CompletionContract.inheritedRouteFloor`, whose refusal reads:
 *
 *   > Inherited route X **is applicable to this subject** and has no disposition.
 *
 * For the Pima meetings obligation, 20 of the 28 ids in that list came from the
 * method store on UNKNOWN portability with all four typed dimensions empty on
 * both sides. `appliesTo` said of every one of them, in its own words,
 * "portability unknown — OFFERED, NOT PROVEN". So the completion evaluator was
 * asserting, as the premise of its most important refusal, the exact claim the
 * projection one layer down refuses to make. That is a false sentence inside our
 * own machinery, and correct-first says fix the premise rather than the count.
 *
 * The consequence was not cosmetic either. Every active route in the committed
 * store carries UNKNOWN portability, so the same ~20 techniques join the floor
 * of EVERY meetings obligation in EVERY jurisdiction. A refusal that fires
 * identically for every subject regardless of what was actually walked carries
 * no information, and it buries the one refusal that does: MTG-13 shipped three
 * of fourteen Pima sittings because `/EventDates` was never walked, and that
 * refusal must be legible as itself, not as line 14 of 21.
 *
 * So the floor is SPLIT along applicability, and the two halves are named:
 *
 *   - `REQUIRED`    — applicability is PROVEN for this obligation. Omission is
 *                     the MTG-13 defect and refuses the close BY NAME.
 *   - `EXPLORATORY` — a method hypothesis worth testing here, applicability NOT
 *                     proven. It is materialised, scheduled, walked and
 *                     disposed like anything else, and an unwalked one STILL
 *                     holds the obligation open (RULING 184: a finite attempt
 *                     count never earns an absence) — but as
 *                     `ROUTE_TASK_STILL_OUTSTANDING`, which claims only that a
 *                     task has not been walked, never that we forgot a known
 *                     API.
 *
 * **NOTHING IS DROPPED AND NOTHING IS EXCLUDED BY ID.** Both halves are owed
 * dispositions and both hold the obligation open. What the split buys is that a
 * speculative disposition can never discharge the guard that exists for known
 * routes, and that a report can state its frontier honestly instead of printing
 * one undifferentiated wall of refusals.
 */
export const FLOOR_OBLIGATIONS = ["REQUIRED", "EXPLORATORY"] as const;
export type FloorObligation = (typeof FLOOR_OBLIGATIONS)[number];

/**
 * WHY a route is REQUIRED, or why it is not. Every value is a fact the system
 * can point at, never a judgement call.
 *
 * The vocabulary is deliberately borrowed rather than invented.
 * `ADAPTER_DECLARED` is an existing `FloorOrigin`; `PORTABILITY_PROVEN` and
 * `APPLICABILITY_UNPROVEN` are the existing `ApplicabilityGrade` values
 * (`PROVEN` / `OFFERED_UNPROVEN`) said in this module's voice. There is no
 * fourth string for NOT_APPLICABLE because a route typed applicability EXCLUDES
 * never reaches the projection at all — it is reported as `excluded`, counted
 * and named on the floor, rather than silently missing.
 */
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
  /**
   * True when the method store OFFERED this route on UNKNOWN portability
   * rather than on evidence that it fits here. It is still owed a disposition —
   * an offer that is never walked teaches nothing — but a report may not claim
   * the route was known to apply.
   *
   * Retained as the plain-boolean view of `obligation === "EXPLORATORY"`, which
   * is the typed one. They are derived from a single decision and cannot drift.
   */
  readonly speculative: boolean;
  /** Which target this route is walked against: a host, a tenant, an endpoint family. */
  readonly target: string;
  /** Does omission of this route refuse the close BY NAME? */
  readonly obligation: FloorObligation;
  /** The named reason for that answer. */
  readonly proof: FloorProof;
  /** The applicability grade this route carries for this jurisdiction. */
  readonly grade: ApplicabilityGrade;
  /**
   * The typed dimensions that actually MATCHED, and the ones nobody stated.
   * These two fields are the audit trail: "this school-district technique
   * reached a county floor because state, governmentType, platform and publisher
   * were all unstated" is a sentence a report can now derive rather than guess.
   */
  readonly matchedDimensions: readonly ApplicabilityDimension[];
  readonly unstatedDimensions: readonly ApplicabilityDimension[];
  /** The field overlap that put it in scope for THIS obligation. */
  readonly matchedFields: readonly string[];
}

/** A route typed applicability EXCLUDES. Counted and named, never silently absent. */
export interface ExcludedRoute {
  readonly routeId: string;
  readonly reason: string;
}

export interface RouteFloor {
  /** The union: everything owed a disposition, required and exploratory alike. */
  readonly routes: readonly FloorRoute[];
  /**
   * Route ids only, in the shape `CompletionContract.inheritedRouteFloor` wants.
   *
   * That is what this field has always said it was, and it is now true: it holds
   * the REQUIRED ids and nothing else. `allRouteIds` is the union.
   */
  readonly routeIds: readonly string[];
  /** Routes whose omission refuses the close by name. */
  readonly required: readonly FloorRoute[];
  /** Method hypotheses to test here. Owed a disposition; never a known route. */
  readonly exploratory: readonly FloorRoute[];
  readonly exploratoryRouteIds: readonly string[];
  /** Required ∪ exploratory. Every id the preflight materialises a task for. */
  readonly allRouteIds: readonly string[];
  /**
   * Routes the method store holds that typed applicability EXCLUDES for this
   * jurisdiction, by id and with the reason. A count of zero is a finding too:
   * it means the typed dimensions did no work.
   */
  readonly excluded: readonly ExcludedRoute[];
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
    const matchedFields = id.fields.filter((f) => input.fields.includes(f));
    if (input.fields.length > 0 && matchedFields.length === 0) continue;

    /*
     * RE-GRADED FROM THE PROJECTED IDENTITY, not from the raw store.
     *
     * `ProjectedRouteIdentity` carries the four typed dimensions and the
     * portability class precisely so a consumer can answer an applicability
     * question without opening a `MethodRoute` (RULING 195). Reconstructing the
     * `Applicability` from those fields keeps the projection the only
     * inheritance interface while still letting the floor read the GRADE rather
     * than the boolean.
     *
     * `note` is empty on purpose: it is the prose field the projection exists to
     * withhold, and `gradeApplicability` never reads it.
     */
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
      matchedFields,
    });
  }

  for (const declared of input.adapterRoutes) {
    const existing = byId.get(declared.routeId);
    /*
     * THE ADAPTER OVERRIDES, AND IT ONLY EVER PROMOTES.
     *
     * A route the adapter declares for THIS publisher is the exact first-party
     * surface this body actually serves. That is proof of applicability of a
     * kind the method store's portability class cannot contradict, so it becomes
     * REQUIRED whatever the store says. The direction matters: this rule can
     * turn an exploratory offer into a required route and never the reverse —
     * "speculative" must never be able to demote a known applicable route into
     * the queue that does not refuse by name.
     */
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
      // PROVEN is the honest grade: this publisher serves this surface.
      grade: "PROVEN",
      matchedDimensions: ["publisher"],
      unstatedDimensions: [],
      matchedFields: [...input.fields],
    });
  }

  const routes = [...byId.values()];
  const required = routes.filter((r) => r.obligation === "REQUIRED");
  const exploratory = routes.filter((r) => r.obligation === "EXPLORATORY");

  /*
   * THE EXCLUSIONS, COUNTED AND NAMED.
   *
   * `projectMethodFor` simply omits a route typed applicability excludes, so an
   * excluded route and a route that was never learned are indistinguishable
   * downstream. Grading the store directly here is a REPORTING read — it makes
   * no inheritance decision and reads no prose — and it turns "2 of 116 routes
   * were excluded, both on platform" into a number a session can act on. Two out
   * of 116 is itself the finding: the typed dimensions are doing almost no work.
   */
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
): { item: WorkItem; routeTasks: RouteTask[]; explorationTasks: RouteTask[] } {
  const task = (r: FloorRoute): RouteTask =>
    createRouteTask({
      workItemId: item.id,
      routeId: r.routeId,
      routeLabel: r.label,
      target: r.target,
      /*
       * BOTH HALVES ARE `inherited`. The flag answers "did this come from the
       * preflight floor, or was it discovered mid-walk?", and an exploratory
       * offer came from the floor. Reusing it to mean "required" would give one
       * field two meanings and would silently re-scope
       * `contract.acceptableDispositions`, which is defined against it.
       */
      inherited: true,
      now,
    });

  const routeTasks = floor.required.map(task);
  const explorationTasks = floor.exploratory.map(task);

  const bound: WorkItem = {
    /*
     * EVERY task is bound to the item — required and exploratory alike — so the
     * scheduler that walks a WorkItem's route tasks picks up the exploration
     * queue by construction. An exploration queue nothing executes is a way of
     * dropping work, and the cheapest guarantee that it runs is that it is not
     * kept anywhere else.
     */
    ...withRouteTasks(item, [...routeTasks, ...explorationTasks].map((t) => t.id)),
    /*
     * ONLY THE REQUIRED IDS REACH THE CONTRACT. `INHERITED_ROUTE_WITHOUT_
     * DISPOSITION` says the route "is applicable to this subject"; this line is
     * what makes that sentence true. The exploratory tasks still hold the
     * obligation open through `ROUTE_TASK_STILL_OUTSTANDING` — they are not
     * excused, they are correctly described.
     */
    contract: { ...item.contract, inheritedRouteFloor: floor.routeIds },
  };

  return { item: bound, routeTasks, explorationTasks };
}

/** ------------------------------------------------------- the guard ------ */

/** Every way a materialised floor can have lost a route it owed. */
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

/**
 * **THE GUARD THAT CATCHES A DROPPED REQUIRED ROUTE.**
 *
 * The split creates one new way to be wrong, and it is the dangerous one: a
 * required adapter-declared surface quietly reclassified as an experiment — or
 * dropped from the contract entirely — because some speculative route succeeded
 * and the numbers looked fine. That failure is invisible in a disposition count
 * (28 routes, 28 dispositions, all green) and it is exactly MTG-13 wearing the
 * new vocabulary.
 *
 * So it is checked structurally, against the adapter's own declaration, after
 * materialisation. Nothing here reads a disposition: a route's obligation may
 * not depend on what any walk returned, or a lucky speculative hit becomes a
 * reason to stop owing a known route.
 */
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

/** ------------------------------------------- the exploration scheduler -- */

/** What executing one experiment produced. */
export const EXPLORATION_STATES = [
  /** The experiment ran and reached a disposition. */
  "WALKED",
  /**
   * The scheduler asked and the executor could not walk it HERE, YET, and said
   * why. This is a fact about our capability, never about the publisher, and it
   * leaves the RouteTask outstanding.
   */
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

/**
 * **RUN THE EXPLORATION QUEUE.**
 *
 * The queue exists because a hypothesis worth recording is worth testing, and a
 * queue nothing executes is a way of dropping work while appearing to track it.
 * So the split ships with the thing that consumes it: every exploratory route is
 * offered to the executor, in order, and every one comes back with either a
 * disposition or a NAMED reason it could not be walked here yet.
 *
 * `UNTESTED` is not a disposition and is never written as one. A technique we
 * have no way to execute against this publisher has told us about OURSELVES —
 * writing `WALKED_NO_YIELD` for it would convert "we cannot run this" into "this
 * found nothing", which is the single conversion this product cannot survive.
 * The task stays outstanding and the obligation stays open on it.
 */
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

/**
 * What a preflight report says out loud.
 *
 * Deliberately prints the floor AND the unclassified population. A session that
 * sees "8 routes inherited" without "112 entries hold prose nobody classified"
 * would reasonably believe the store had been exhausted.
 */
export function describeFloor(floor: RouteFloor): string {
  const line = (r: FloorRoute): string => {
    const dims =
      r.matchedDimensions.length > 0
        ? `matched ${r.matchedDimensions.join("+")}`
        : "matched NOTHING";
    const unstated =
      r.unstatedDimensions.length > 0 ? `; unstated ${r.unstatedDimensions.join("+")}` : "";
    return (
      `  ${r.routeId}  (${r.origins.join("+")}) [${r.proof}]\n` +
      `      ${r.label} -> ${r.target}\n` +
      `      ${dims}${unstated}` +
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
