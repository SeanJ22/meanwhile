/**
 * **MW-028 — SENDING THE FLEET TO A GEOGRAPHY CREATES THE WORK IT IS MISSING.**
 * (2026-09-23. RULING 248, RULING 250, RULING 251, RULING 271, RULING 273,
 * RULING 282/283.)
 *
 * The owner's direction, 2026-09-23: *"This shouldn't be a code change — new
 * areas states will be added rapidly, it needs to be able to track and keep up
 * everywhere, not just a small subset."* Until now a Send only REORDERED work
 * the registry had already put on a clock. A geography with no clocks got
 * nothing, and the Send screen said so.
 *
 * ## The data it reads, and nothing else
 *
 * ```
 *   the owner's intent      AdminConfig.expansionScopes (expansion.scope.set) and
 *                           the DISPATCH research intents (fleet.deployHere). The
 *                           gateway records them; it never creates work
 *   the geography           the published Census geography lookup
 *                           (CENSUS_GEOGRAPHY, US:zcta-geography-overlaps): every
 *                           ZCTA of the scope, whole or partial
 *   who is in it            data/derived/census-unit-zips.json (the ZCTA territory
 *                           of every Census of Governments unit, nationally) and
 *                           data/derived/zip-governments.json (each unit's share of
 *                           each ZCTA), joined to the registries by the
 *                           generator's own id rule (membership.ts)
 *   what each one owes      the promoted operational-reference jurisdiction
 *                           registries (OPERATIONAL_REFERENCE,
 *                           US:covered-jurisdiction-routing:v1): every source the
 *                           registry defines for the government, custodian-
 *                           deduped (local-jurisdictions.ts), and its meetings
 *                           discovery need in the gap ledger's shape
 *                           (lib/hunt/meetings-discovery.ts, the same derivation
 *                           that writes data/derived/gap-ledger.json)
 *   what already exists     this cycle's registry corpus and the durable
 *                           obligation rows (cp_obligations)
 * ```
 *
 * No state list, no county list and no body list is written here or anywhere
 * this module reaches. A geography in a state whose registry is not promoted
 * has governments the Census names and no requirement definitions, so it is
 * BLOCKED by name: a Census unit is a government, but a requirement no registry
 * defines is a lead, never work (RULING 251). Registering the state — its
 * registry in the promoted bundle — is the whole change needed to unblock it.
 *
 * ## The state machine
 *
 * For each target (a selected scope, or a DISPATCH that names a state) and each
 * government in it, every requirement instance lands in exactly one state:
 *
 * ```
 *   CARRIED    a standing provider already has it on a clock (or a production
 *              meeting partition carries it). The Send puts it first — the
 *              "reordered" count. Nothing is written
 *   CREATED    the owner's dispatch materialized it: a durable obligation in
 *              the same shape `syncObligations` registers (`standing()`),
 *              marked `materializedBy: OWNER_DISPATCH`. The providers keep it
 *              in their corpus from the next cycle, so it is scheduled, owed and
 *              retired like any other clock
 *   DEFERRED   missing, inside the cap, and not written this cycle because the
 *              per-cycle write budget ran out (or the dispatch wall came). The
 *              next cycle writes it: the remainder is counted, never dropped
 *   CAPPED     missing, beyond this target's cap. Named, with the cap. Sending
 *              a smaller geography reaches it
 *   HELD       a machine-openable meetings route whose partition ownership
 *              cannot be read: never a second meetings clock
 * ```
 *
 * A government the target holds but no dataset can give requirements to is
 * BLOCKED, with the missing dataset named: the lookup did not resolve the
 * geography, the territory files could not be read, the state has no promoted
 * registry, or the registry does not carry that Census unit.
 *
 * ## The bounds, and the authority it does not have
 *
 * - **Idempotent.** Ids are derived from (government, requirement), never from
 *   the target, so the same requirement is one row however many overlapping
 *   geographies or repeated Sends reach it. Sending the same scope twice creates
 *   nothing new.
 * - **Bounded.** At most `DISPATCH_WORK_WRITE_BUDGET` rows are written per cycle
 *   across every target (owner DISPATCH first, then scopes in priority order),
 *   and at most `DISPATCH_WORK_TARGET_CAP` rows for any one target.
 * - **One writer.** Only the standing runner calls `applyDispatchWork`, inside
 *   its cycle lease. The gateway actions record the owner's intent and nothing
 *   else; Admin reads the counts this module writes onto the research state.
 * - **No paid work.** Creating a row calls no model, appends no intent, and
 *   never touches the research pause or the activation gate (a code constant).
 *   A created row that needs a model is model-class work and waits exactly as
 *   every other one does: the paid lane is closed while the owner's PAUSE
 *   stands or no delivery path is open, and when it opens every Scout still
 *   passes the Fleet's rolling ceiling (AdminConfig.fleetSpendCeiling, or the
 *   FLEET_SAFETY_BOUNDS fallback) and the scope's own budget
 *   (`ScopeBudgetGate`). There is no per-assignment budget (MW-021); the
 *   budget that binds inside a geography is the geography's. Deterministic rows
 *   run on the plain-code lane as they come due. A meetings-discovery row goes
 *   to the unpaid discovery walk first: a paid Scout is admitted for it only
 *   after that walk read the government's site and found nothing
 *   (`paidDiscoveryHold`, code FREE_WALK_FIRST), so the paid lane never
 *   re-walks what the free lane read.
 * - **The denominator stays the authority's.** A geography orders which part
 *   of the registry's universe is materialized first (RULING 248 cl. 6); every
 *   requirement it creates was already owed, and the gap ledger keeps recording
 *   the rest.
 *
 * PURE apart from `applyDispatchWork`, which writes only through the
 * repositories it is handed. No clock, no environment, no file.
 */

import { OWNER_DISPATCH, type FreshnessObligation } from "../scheduler/obligation.ts";
import { standing } from "../scheduler/durable.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ExecutorKind } from "../scheduler/dispatch.ts";
import { parseDispatchTarget, unitMatchesTarget, type DispatchTarget } from "../scheduler/dispatch-target.ts";
import type { MeetingPartitionOwnership } from "../scheduler/provider-inputs.ts";
import { jurisdictionRequirements } from "../scheduler/providers/local-jurisdictions.ts";
import {
  MEETINGS_DISCOVERY_RECORD_CLASS,
  meetingsDiscoveryObligationId,
  meetingsDiscoveryRoute,
} from "../scheduler/providers/meetings-discovery.ts";
import { meetingsDiscoveryNeeds, type MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { Jurisdiction, JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";
import {
  certainlyOverlaps,
  unitsCertainlyIn,
  type CensusUnitTerritory,
  type PlannedScope,
  type TerritoryIndex,
} from "./membership.ts";
import { READING_LIST_CAP, isVersionedCycleReading } from "./reading.ts";
import { DISPATCH_WORK_TARGET_CAP, DISPATCH_WORK_WRITE_BUDGET } from "./dispatch-work-bounds.ts";

/* ------------------------------------------------------------------ bounds */

export const DISPATCH_WORK_FORMAT_VERSION = 1;

/* The two bounds live in a pure module the gateway, the preview and the Send screen also quote. */
export { DISPATCH_WORK_TARGET_CAP, DISPATCH_WORK_WRITE_BUDGET };

/** Where the datasets a blocked reason names live, in the words a receipt prints. */
export const DATASET = {
  lookup: "the published Census geography lookup (CENSUS_GEOGRAPHY / US:zcta-geography-overlaps)",
  territory: "data/derived/census-unit-zips.json and data/derived/zip-governments.json",
  registry: (state: string) =>
    `the promoted ${state.toUpperCase()} jurisdiction registry (OPERATIONAL_REFERENCE / US:covered-jurisdiction-routing:v1)`,
  unitTerritory: "data/derived/census-unit-zips.json (no ZCTA territory: TIGER publishes no boundary for it)",
  wiring: "the promoted meeting-partition source wiring",
  instruction: "a geography in the instruction (a state named in the words, or a geography sent from the Census lookup)",
  reader: "the operational-reference registry reader (lib/civic-data/operational-references.ts, the states it reads)",
} as const;

/* ----------------------------------------------------------------- targets */

/** One thing the owner sent the fleet to. */
export type DispatchWorkTarget =
  | {
      readonly kind: "SCOPE";
      /** The scope key, `county:2020/04019`. */
      readonly key: string;
      readonly label: string;
      readonly requestedAt: string;
      /** The gateway receipt that carries the owner's decision. */
      readonly ref: string;
      readonly budgetUsd: number;
      readonly scope: PlannedScope;
    }
  | {
      readonly kind: "DISPATCH";
      /** `dispatch:<intent id>`. */
      readonly key: string;
      readonly label: string;
      readonly requestedAt: string;
      /** The DISPATCH intent id. */
      readonly ref: string;
      readonly target: DispatchTarget;
    };

/* ------------------------------------------------------------------- world */

/** A durable obligation row, as much of it as the classification reads. */
export interface DurableRowFacts {
  readonly active: boolean;
  readonly materializedBy?: string;
}

/** Everything the planner reads, loaded once by the runner. */
export interface DispatchWorkWorld {
  /** Every promoted jurisdiction registry, keyed by lower-case state code. */
  readonly registries: ReadonlyMap<string, JurisdictionRegistry>;
  /** The territory index the expansion plan placed with; null when not built. */
  readonly territory: TerritoryIndex | null;
  readonly territoryDetail: string | null;
  /** This cycle's registry corpus: every obligation any provider emitted. */
  readonly corpus: readonly { readonly id: string; readonly subjectId: string }[];
  /** Every durable obligation row, in the corpus or outside it, active or retired. */
  readonly durable: ReadonlyMap<string, DurableRowFacts>;
  readonly meetingPartitions: MeetingPartitionOwnership;
  /** Census units by state (upper), for a DISPATCH to a state with no registry. Null when not read. */
  readonly censusUnitsByState?: ReadonlyMap<string, number> | null;
  /** Registries the promoted bundle carries that the runtime's reader refuses, by lower-case state, with the reason. */
  readonly refusedRegistries?: ReadonlyMap<string, string>;
}

/* ---------------------------------------------------------- requirements */

export type RequirementKind = "MEETINGS_DISCOVERY" | "REGISTRY_ROUTE";

/** One requirement instance the registry defines for one government. */
export interface RequirementInstance {
  /** The exact row a creation writes: `standing()` of this, marked OWNER_DISPATCH. */
  readonly obligation: FreshnessObligation;
  readonly kind: RequirementKind;
  readonly executor: ExecutorKind;
  /** How it is carried when no clock exists yet. HELD never becomes a row. */
  readonly carriage: "OWED" | "MEETING_PARTITION" | "HELD_UNREAD_WIRING";
}

function obligationOf(id: string, recordClass: string, subjectId: string, routeId: string): FreshnessObligation {
  return {
    id,
    recordClass,
    subjectId,
    routeId,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    materializedBy: OWNER_DISPATCH,
  };
}

/**
 * Every requirement instance the registry defines for one government: its
 * registry routes (with the ids the local-jurisdictions provider gives them)
 * and its meetings discovery need (with the ids the meetings-discovery
 * provider gives it). Sorted by id.
 */
export function requirementsFor(
  reg: JurisdictionRegistry,
  j: Jurisdiction,
  need: MeetingsDiscoveryNeed | null,
  meetingPartitions: MeetingPartitionOwnership,
): RequirementInstance[] {
  const out: RequirementInstance[] = [];
  for (const r of jurisdictionRequirements(reg, j, meetingPartitions)) {
    out.push({
      obligation: obligationOf(r.obligationId, "local-jurisdiction", j.id, r.route.routeId),
      kind: "REGISTRY_ROUTE",
      executor: r.route.executorClass,
      carriage: r.carriage === "HERE" ? "OWED" : r.carriage,
    });
  }
  if (need !== null) {
    const route = meetingsDiscoveryRoute(reg, need);
    out.push({
      obligation: obligationOf(meetingsDiscoveryObligationId(need), MEETINGS_DISCOVERY_RECORD_CLASS, j.id, route.routeId),
      kind: "MEETINGS_DISCOVERY",
      executor: route.executorClass,
      carriage: "OWED",
    });
  }
  return out.sort((a, b) => (a.obligation.id < b.obligation.id ? -1 : a.obligation.id > b.obligation.id ? 1 : 0));
}

/* ------------------------------------------------------------------- units */

export type BlockedCode =
  | "GEOGRAPHY_UNRESOLVED"
  | "TERRITORY_UNREADABLE"
  | "NO_JURISDICTION_REGISTRY"
  | "NOT_IN_REGISTRY"
  | "REGISTRY_NOT_READ"
  | "NO_STATE_NAMED";

/** Governments a target holds that no dataset can give requirements to, and the dataset that is missing. */
export interface BlockedUnits {
  readonly code: BlockedCode;
  /** The missing dataset, by name. */
  readonly dataset: string;
  readonly why: string;
  /** How many governments it blocks; null when the count itself cannot be taken. */
  readonly units: number | null;
  readonly states: readonly string[];
  readonly sample: readonly string[];
}

interface PlacedUnit {
  readonly reg: JurisdictionRegistry;
  readonly jurisdiction: Jurisdiction;
}

interface TargetUnits {
  readonly placed: readonly PlacedUnit[];
  readonly blocked: readonly BlockedUnits[];
  /** Governments of the target's states no territory can place in or out: registry rows the join cannot place, and Census units with no ZCTA territory. */
  readonly unplaced: number;
}

const byName = (a: CensusUnitTerritory, b: CensusUnitTerritory): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function scopeUnits(scope: PlannedScope, world: DispatchWorkWorld): TargetUnits {
  if (scope.kind !== "RESOLVED") {
    return {
      placed: [],
      blocked: [{ code: "GEOGRAPHY_UNRESOLVED", dataset: DATASET.lookup, why: scope.why, units: null, states: scope.states, sample: [] }],
      unplaced: 0,
    };
  }
  const index = world.territory;
  if (index === null) {
    return {
      placed: [],
      blocked: [
        {
          code: "TERRITORY_UNREADABLE",
          dataset: DATASET.territory,
          why: `the territory index could not be built (${world.territoryDetail ?? "no detail"}), so no government can be placed in this geography`,
          units: null,
          states: scope.states,
          sample: [],
        },
      ],
      unplaced: 0,
    };
  }
  const placed: PlacedUnit[] = [];
  const rowsByState = new Map<string, ReadonlyMap<string, Jurisdiction>>();
  for (const territory of index.bySubject.values()) {
    if (!certainlyOverlaps(territory, scope)) continue;
    const state = territory.stateCode.toLowerCase();
    const reg = world.registries.get(state);
    if (reg === undefined) continue;
    let rows = rowsByState.get(state);
    if (rows === undefined) {
      rows = new Map(reg.jurisdictions.map((row) => [row.id, row]));
      rowsByState.set(state, rows);
    }
    const j = rows.get(territory.subjectId);
    if (j !== undefined) placed.push({ reg, jurisdiction: j });
  }
  placed.sort((a, b) => (a.jurisdiction.id < b.jurisdiction.id ? -1 : a.jurisdiction.id > b.jurisdiction.id ? 1 : 0));

  const blocked: BlockedUnits[] = [];
  const sharesOf = index.unitShares ?? (() => undefined);
  for (const state of scope.states) {
    const unregistered = unitsCertainlyIn(scope, index.unregisteredUnitsByState.get(state) ?? [], sharesOf).sort(byName);
    const refusedWhy = world.refusedRegistries?.get(state.toLowerCase()) ?? null;
    if (unregistered.length > 0 && refusedWhy !== null) {
      blocked.push({
        code: "REGISTRY_NOT_READ",
        dataset: DATASET.reader,
        why:
          `${unregistered.length} Census of Governments unit(s) in ${state} lie in this geography. ${state}'s registry is promoted, and this ` +
          `runtime's registry reader refuses it (${refusedWhy}), so nothing it defines can be scheduled yet`,
        units: unregistered.length,
        states: [state],
        sample: unregistered.slice(0, READING_LIST_CAP).map((u) => u.name),
      });
    } else if (unregistered.length > 0) {
      blocked.push({
        code: "NO_JURISDICTION_REGISTRY",
        dataset: DATASET.registry(state),
        why:
          `${unregistered.length} Census of Governments unit(s) in ${state} lie in this geography, and ${state} has no promoted ` +
          "jurisdiction registry, so nothing defines what they owe. Promoting its registry is the whole change that unblocks them",
        units: unregistered.length,
        states: [state],
        sample: unregistered.slice(0, READING_LIST_CAP).map((u) => u.name),
      });
    }
    const unjoined = unitsCertainlyIn(scope, index.unjoinedUnitsByState?.get(state) ?? [], sharesOf).sort(byName);
    if (unjoined.length > 0) {
      blocked.push({
        code: "NOT_IN_REGISTRY",
        dataset: DATASET.registry(state),
        why:
          `${unjoined.length} Census of Governments unit(s) in this geography are not carried by the ${state} registry ` +
          "(no row joins them by the generator's id rule), so nothing defines what they owe",
        units: unjoined.length,
        states: [state],
        sample: unjoined.slice(0, READING_LIST_CAP).map((u) => u.name),
      });
    }
  }
  /* Governments of the scope's states no territory can place in or out: registry rows the join could not place, and Census units with no ZCTA territory. */
  const scopeStates = new Set(scope.states.map((s) => s.toLowerCase()));
  const unplacedRegistered = [...index.unplaced.keys()].filter((id) => scopeStates.has(id.split(":")[0] ?? "")).length;
  const unplacedCensus = scope.states.reduce(
    (n, state) => n + (index.unregisteredUnitsByState.get(state) ?? []).filter((u) => u.zips.length === 0).length,
    0,
  );
  const unplaced = unplacedRegistered + unplacedCensus;
  return { placed, blocked, unplaced };
}

function dispatchUnits(target: DispatchTarget, world: DispatchWorkWorld): TargetUnits {
  if (target.states.length === 0) {
    return {
      placed: [],
      blocked: [
        {
          code: "NO_STATE_NAMED",
          dataset: DATASET.instruction,
          why:
            "creating work needs a bounded geography: a state named in the words, or a geography sent from the Census lookup. " +
            "These words still put matching registered work first",
          units: null,
          states: [],
          sample: [],
        },
      ],
      unplaced: 0,
    };
  }
  const placed: PlacedUnit[] = [];
  const blocked: BlockedUnits[] = [];
  for (const code of target.states) {
    const reg = world.registries.get(code);
    if (reg === undefined) {
      const count = world.censusUnitsByState?.get(code.toUpperCase()) ?? null;
      const refusedWhy = world.refusedRegistries?.get(code) ?? null;
      if (refusedWhy !== null) {
        blocked.push({
          code: "REGISTRY_NOT_READ",
          dataset: DATASET.reader,
          why:
            `${code.toUpperCase()}'s registry is promoted, and this runtime's registry reader refuses it (${refusedWhy}), ` +
            "so nothing it defines can be scheduled yet",
          units: count,
          states: [code.toUpperCase()],
          sample: [],
        });
        continue;
      }
      blocked.push({
        code: "NO_JURISDICTION_REGISTRY",
        dataset: DATASET.registry(code),
        why:
          `${target.stateNames[target.states.indexOf(code)] ?? code.toUpperCase()} has no promoted jurisdiction registry, so nothing defines ` +
          `what its governments owe${count === null ? "" : `; the Census of Governments names ${count} of them`}. Promoting its registry is the whole change that unblocks it`,
        units: count,
        states: [code.toUpperCase()],
        sample: [],
      });
      continue;
    }
    for (const j of reg.jurisdictions) {
      if (unitMatchesTarget({ ...target, states: [code] }, { id: j.id, subjectId: j.id })) placed.push({ reg, jurisdiction: j });
    }
  }
  placed.sort((a, b) => (a.jurisdiction.id < b.jurisdiction.id ? -1 : a.jurisdiction.id > b.jurisdiction.id ? 1 : 0));
  return { placed, blocked, unplaced: 0 };
}

/* -------------------------------------------------------------------- plan */

export type InstanceState = "CARRIED" | "CREATED" | "MISSING" | "CAPPED" | "HELD";

export interface PlannedInstance {
  readonly instance: RequirementInstance;
  readonly state: InstanceState;
  /** For a MISSING instance whose row already exists durably (retired, or live outside the corpus): it is marked, not put. */
  readonly existsUnmarked: boolean;
}

export interface TargetPlan {
  readonly target: DispatchWorkTarget;
  readonly units: TargetUnits;
  readonly instances: readonly PlannedInstance[];
  /** Obligations in this cycle's corpus about the target (not materialized): the work a Send reorders. */
  readonly reordered: number;
}

export interface DispatchWorkPlan {
  readonly targets: readonly TargetPlan[];
  /** Every MISSING instance, in write order, each once. */
  readonly writes: readonly PlannedInstance[];
  readonly writeBudget: number;
  readonly cap: number;
  readonly corpusSize: number;
}

/**
 * **PLAN.** Classify every requirement instance of every target, and order the
 * missing ones for writing: the owner's DISPATCH targets first (oldest first),
 * then scopes in their run order, each target's governments by id. An instance
 * two targets share is written once, under the first.
 */
export function planDispatchWork(input: {
  readonly targets: readonly DispatchWorkTarget[];
  readonly world: DispatchWorkWorld;
  readonly writeBudget?: number;
  readonly cap?: number;
}): DispatchWorkPlan {
  const writeBudget = input.writeBudget ?? DISPATCH_WORK_WRITE_BUDGET;
  const cap = input.cap ?? DISPATCH_WORK_TARGET_CAP;
  const world = input.world;
  const corpusIds = new Set(world.corpus.map((o) => o.id));
  const needsByState = new Map<string, Map<string, MeetingsDiscoveryNeed>>();
  const needOf = (reg: JurisdictionRegistry, id: string): MeetingsDiscoveryNeed | null => {
    const key = reg.stateCode.toLowerCase();
    let needs = needsByState.get(key);
    if (needs === undefined) {
      needs = new Map(meetingsDiscoveryNeeds([reg]).map((n) => [n.jurisdictionId, n]));
      needsByState.set(key, needs);
    }
    return needs.get(id) ?? null;
  };

  const ordered = [
    ...input.targets.filter((t) => t.kind === "DISPATCH").sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0)),
    ...input.targets.filter((t) => t.kind === "SCOPE"),
  ];

  const targets: TargetPlan[] = [];
  const writes: PlannedInstance[] = [];
  const queued = new Set<string>();
  for (const target of ordered) {
    const units = target.kind === "SCOPE" ? scopeUnits(target.scope, world) : dispatchUnits(target.target, world);
    const instances: RequirementInstance[] = [];
    for (const { reg, jurisdiction } of units.placed) {
      instances.push(...requirementsFor(reg, jurisdiction, needOf(reg, jurisdiction.id), world.meetingPartitions));
    }

    let window = 0;
    const planned: PlannedInstance[] = [];
    for (const instance of instances) {
      const id = instance.obligation.id;
      const row = world.durable.get(id);
      if (instance.carriage === "HELD_UNREAD_WIRING") {
        planned.push({ instance, state: "HELD", existsUnmarked: false });
        continue;
      }
      if (instance.carriage === "MEETING_PARTITION") {
        planned.push({ instance, state: "CARRIED", existsUnmarked: false });
        continue;
      }
      if (row?.materializedBy === OWNER_DISPATCH) {
        window += 1;
        planned.push({ instance, state: "CREATED", existsUnmarked: false });
        continue;
      }
      if (corpusIds.has(id) && row?.active !== false) {
        planned.push({ instance, state: "CARRIED", existsUnmarked: false });
        continue;
      }
      if (window >= cap) {
        planned.push({ instance, state: "CAPPED", existsUnmarked: row !== undefined });
        continue;
      }
      window += 1;
      const entry: PlannedInstance = { instance, state: "MISSING", existsUnmarked: row !== undefined };
      planned.push(entry);
      if (!queued.has(id)) {
        queued.add(id);
        writes.push(entry);
      }
    }

    const members = new Set(units.placed.map((u) => u.jurisdiction.id));
    const reordered =
      target.kind === "SCOPE"
        ? world.corpus.filter((o) => members.has(o.subjectId) && world.durable.get(o.id)?.materializedBy !== OWNER_DISPATCH).length
        : target.target.states.length === 0 && target.target.terms.length === 0
          ? 0
          : world.corpus.filter((o) => unitMatchesTarget(target.target, o) && world.durable.get(o.id)?.materializedBy !== OWNER_DISPATCH).length;
    targets.push({ target, units, instances: planned, reordered });
  }
  return { targets, writes, writeBudget, cap, corpusSize: world.corpus.length };
}

/* ------------------------------------------------------------------- apply */

export interface DispatchWorkApplied {
  readonly written: readonly string[];
  readonly failed: readonly { readonly obligationId: string; readonly why: string }[];
  /** Planned writes not reached this cycle: the budget or the wall ran out first. */
  readonly deferred: readonly string[];
  readonly stoppedBy: "DONE" | "WRITE_BUDGET" | "DEADLINE";
}

/**
 * **APPLY.** Write the plan's missing rows in order, up to the write budget,
 * stopping early when `deadlineReached` says the cycle's wall is near. A row
 * nobody holds is registered exactly as `syncObligations` registers a new one
 * (`standing()`), marked OWNER_DISPATCH. A row that exists unmarked — retired,
 * or live outside the corpus — is marked and made active again, keeping its
 * runtime history (occurrences, last work, argued absence). One row's failure
 * is named and never stops the others. The runner is the only caller.
 */
export async function applyDispatchWork(
  repos: ControlPlaneRepositories,
  plan: DispatchWorkPlan,
  input: { readonly now: string; readonly deadlineReached?: () => boolean },
): Promise<DispatchWorkApplied> {
  const written: string[] = [];
  const failed: { obligationId: string; why: string }[] = [];
  const deferred: string[] = [];
  let stoppedBy: DispatchWorkApplied["stoppedBy"] = "DONE";
  for (const entry of plan.writes) {
    const id = entry.instance.obligation.id;
    if (stoppedBy !== "DONE") {
      deferred.push(id);
      continue;
    }
    if (written.length + failed.length >= plan.writeBudget) {
      stoppedBy = "WRITE_BUDGET";
      deferred.push(id);
      continue;
    }
    if (input.deadlineReached?.() === true) {
      stoppedBy = "DEADLINE";
      deferred.push(id);
      continue;
    }
    try {
      if (!entry.existsUnmarked) {
        await repos.obligations.put(id, standing(entry.instance.obligation, input.now), input.now);
      } else {
        const held = await repos.obligations.mustRead(id);
        if (held.value.materializedBy !== OWNER_DISPATCH) {
          const { retiredAt: _retiredAt, retirementReason: _retirementReason, ...rest } = held.value;
          await repos.obligations.compareAndSet(
            id,
            held.revision,
            {
              ...rest,
              active: true,
              nextDueAt: held.value.active ? held.value.nextDueAt : null,
              materializedBy: OWNER_DISPATCH,
              updatedAt: input.now,
            },
            input.now,
          );
        }
      }
      written.push(id);
    } catch (error) {
      failed.push({ obligationId: id, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { written, failed, deferred, stoppedBy };
}

/* ----------------------------------------------------------------- reading */

export interface DispatchWorkRequirementCounts {
  /** Requirement instances the registry defines for the governments placed in the target: the denominator. */
  readonly defined: number;
  /** Already on a standing clock (or a meeting partition): put first, not created. */
  readonly carried: number;
  /** Materialized by the owner's dispatch, cumulative, this cycle's included. */
  readonly created: number;
  readonly createdThisCycle: number;
  /** Missing, inside the cap, not written this cycle. The next cycle writes them. */
  readonly deferred: number;
  /** Missing, beyond the cap. */
  readonly capped: number;
  /** Written this cycle and refused by the store; retried next cycle. */
  readonly failed: number;
  /** Machine-openable meetings routes held because the partition wiring could not be read. */
  readonly held: number;
  /** Of `created`, how many run on the plain-code lane and how many need a model. */
  readonly createdDeterministic: number;
  readonly createdModel: number;
  /** Of `created`, how many are meetings discovery: the free discovery walk takes them first. */
  readonly createdMeetingsDiscovery: number;
}

export interface DispatchWorkTargetReading {
  readonly key: string;
  readonly kind: DispatchWorkTarget["kind"];
  readonly label: string;
  readonly requestedAt: string;
  readonly ref: string;
  readonly units: {
    /** Governments placed in the target that the registry gives requirements to. */
    readonly placed: number;
    /** Governments the target holds that a missing dataset blocks; null when that count cannot be taken. */
    readonly blocked: number | null;
    /** Governments of the target's states that no territory can place in or out (registry rows and Census-only units alike). */
    readonly unplaced: number;
    readonly placedSample: readonly string[];
  };
  readonly blocked: readonly BlockedUnits[];
  readonly requirements: DispatchWorkRequirementCounts;
  /** Standing obligations about the target's governments, of every standing obligation this cycle. */
  readonly reordered: { readonly obligations: number; readonly of: number };
  readonly cap: number;
  /** Plain sentences: why created work waits, which budgets bind, what is not built. */
  readonly says: readonly string[];
}

export interface DispatchWorkReading {
  readonly formatVersion: 1;
  readonly at: string;
  /** PLAN_ONLY on a cycle that may not write (dry, canary, filtered, blackout, runner paused), with why. */
  readonly writes: "APPLIED" | "PLAN_ONLY";
  readonly planOnlyWhy: string | null;
  readonly writeBudget: number;
  readonly written: number;
  readonly deferred: number;
  readonly failed: readonly { readonly obligationId: string; readonly why: string }[];
  readonly stoppedBy: DispatchWorkApplied["stoppedBy"] | null;
  readonly targets: readonly DispatchWorkTargetReading[];
}

/** What binds the created work, from the cycle's own readings. */
export interface DispatchWorkContext {
  readonly at: string;
  /** Why the paid lane is closed this cycle, verbatim from `modelLaneClosure`; null when it is open. */
  readonly modelLaneClosed: string | null;
  /** The rolling 24-hour ceiling in force, and whether it is the owner's dial or the fallback. */
  readonly ceilingUsd: number;
  readonly ceilingSource: "OVERRIDE" | "FALLBACK";
  readonly writes: "APPLIED" | "PLAN_ONLY";
  readonly planOnlyWhy: string | null;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** The reading the runner writes onto the research state, and the HONORED detail reads. */
export function dispatchWorkReading(
  plan: DispatchWorkPlan,
  applied: DispatchWorkApplied | null,
  context: DispatchWorkContext,
): DispatchWorkReading {
  const written = new Set(applied?.written ?? []);
  const failed = new Set((applied?.failed ?? []).map((f) => f.obligationId));
  const targets = plan.targets.map((t): DispatchWorkTargetReading => {
    let carried = 0;
    let created = 0;
    let createdThisCycle = 0;
    let deferred = 0;
    let capped = 0;
    let failedHere = 0;
    let held = 0;
    let createdDeterministic = 0;
    let createdModel = 0;
    let createdMeetingsDiscovery = 0;
    for (const p of t.instances) {
      const id = p.instance.obligation.id;
      const isCreated = p.state === "CREATED" || (p.state === "MISSING" && written.has(id));
      if (isCreated) {
        created += 1;
        if (p.state === "MISSING") createdThisCycle += 1;
        if (p.instance.executor === "DETERMINISTIC") createdDeterministic += 1;
        else createdModel += 1;
        if (p.instance.kind === "MEETINGS_DISCOVERY") createdMeetingsDiscovery += 1;
      } else if (p.state === "CARRIED") carried += 1;
      else if (p.state === "HELD") held += 1;
      else if (p.state === "CAPPED") capped += 1;
      else if (failed.has(id)) failedHere += 1;
      else deferred += 1;
    }
    const blockedCounts = t.units.blocked.map((b) => b.units);
    const blocked = blockedCounts.some((n) => n === null) ? null : blockedCounts.reduce<number>((a, n) => a + (n ?? 0), 0);
    const says: string[] = [];
    if (context.writes === "PLAN_ONLY") says.push(`Planned only, nothing written this cycle: ${context.planOnlyWhy ?? "this cycle may not write"}.`);
    if (createdMeetingsDiscovery > 0) {
      says.push(
        `${createdMeetingsDiscovery} of the created obligations are meetings discovery: the free discovery walk takes them first, and a paid Scout ` +
          "takes one up only where that walk read the government's site and found nothing.",
      );
    }
    if (createdModel > 0) {
      says.push(
        context.modelLaneClosed === null
          ? `${createdModel} of the created obligations need a model; they run only as the paid lane admits them.`
          : `${createdModel} of the created obligations need a model and wait: ${context.modelLaneClosed}.`,
      );
      says.push(
        `When the paid lane runs, every Scout passes the Fleet's ${usd(context.ceilingUsd)} rolling 24-hour ceiling ` +
          `(${context.ceilingSource === "OVERRIDE" ? "your dial" : "the built-in fallback"}) first` +
          (t.target.kind === "SCOPE" ? `, then this geography's ${usd(t.target.budgetUsd)} budget.` : ".") +
          " There is no per-assignment budget yet (MW-021).",
      );
    }
    if (createdDeterministic > 0) says.push(`${createdDeterministic} run on the plain-code lane as they come due, at no model cost.`);
    if (deferred > 0) {
      says.push(
        `${deferred} more are owed and not yet written: at most ${plan.writeBudget} are written per cycle across every geography` +
          (applied?.stoppedBy === "DEADLINE" ? ", and this cycle's wall came first" : "") + "; the next cycle continues.",
      );
    }
    if (capped > 0) says.push(`${capped} are beyond this geography's cap of ${plan.cap}; send a smaller geography to reach them.`);
    if (held > 0) says.push(`${held} machine-openable meetings route(s) are held: ${DATASET.wiring} could not be read, and a second meetings clock is never risked.`);
    for (const b of t.units.blocked) says.push(`Blocked (${b.dataset}): ${b.why}.`);
    if (t.units.unplaced > 0) {
      says.push(
        `${t.units.unplaced} government(s) in ${t.target.kind === "SCOPE" ? t.target.scope.states.join(", ") : "these states"} cannot be placed in or out of ` +
          `any geography — most have no ZCTA territory (${DATASET.unitTerritory}), the rest join no single Census unit — so they are counted here and never guessed in.`,
      );
    }
    return {
      key: t.target.key,
      kind: t.target.kind,
      label: t.target.label,
      requestedAt: t.target.requestedAt,
      ref: t.target.ref,
      units: {
        placed: t.units.placed.length,
        blocked,
        unplaced: t.units.unplaced,
        placedSample: t.units.placed.slice(0, READING_LIST_CAP).map((u) => u.jurisdiction.name),
      },
      blocked: t.units.blocked,
      requirements: {
        defined: t.instances.length,
        carried,
        created,
        createdThisCycle,
        deferred,
        capped,
        failed: failedHere,
        held,
        createdDeterministic,
        createdModel,
        createdMeetingsDiscovery,
      },
      reordered: { obligations: t.reordered, of: plan.corpusSize },
      cap: plan.cap,
      says,
    };
  });
  return {
    formatVersion: DISPATCH_WORK_FORMAT_VERSION,
    at: context.at,
    writes: context.writes,
    planOnlyWhy: context.planOnlyWhy,
    writeBudget: plan.writeBudget,
    written: applied?.written.length ?? 0,
    deferred: applied?.deferred.length ?? (context.writes === "PLAN_ONLY" ? plan.writes.length : 0),
    failed: applied?.failed ?? [],
    stoppedBy: applied?.stoppedBy ?? null,
    targets,
  };
}

/** The receipt for one target in a sentence: created, reordered and blocked, each with its denominator. */
export function dispatchWorkSentence(t: DispatchWorkTargetReading): string {
  const r = t.requirements;
  const blocked =
    t.units.blocked === null
      ? "an uncounted number of governments blocked"
      : `${t.units.blocked} of ${t.units.placed + t.units.blocked} governments blocked`;
  return (
    `${t.label}: created ${r.created} of ${r.defined} requirement(s) the registry defines here (${r.createdThisCycle} this cycle` +
    `${r.deferred > 0 ? `, ${r.deferred} deferred to the next cycles` : ""}${r.capped > 0 ? `, ${r.capped} beyond the cap of ${t.cap}` : ""}); ` +
    `reordered ${t.reordered.obligations} of ${t.reordered.of} standing obligations; ${blocked} by missing data.`
  );
}

/**
 * The counts one DISPATCH carries on the owner's dispatch record
 * (`ResearchState.ownerDispatch.work`). The full receipt is the target reading
 * under the same key in `ResearchState.dispatchWork.targets`.
 */
export interface OwnerDispatchWork {
  /** `dispatch:<intent id>`: the target reading's key. */
  readonly key: string;
  readonly defined: number;
  readonly created: number;
  readonly createdThisCycle: number;
  /** Already on a standing clock: reordered, not created. */
  readonly carried: number;
  readonly deferred: number;
  readonly capped: number;
  /** Governments no dataset can give requirements to; null when that count cannot be taken. */
  readonly blockedUnits: number | null;
  /** Each blocked reason: its code, and the plain sentence naming the missing dataset. */
  readonly blocked: readonly { readonly code: BlockedCode; readonly says: string }[];
}

/** The DISPATCH record's counts for one intent, or null when the cycle planned nothing for it. */
export function ownerDispatchWorkOf(reading: DispatchWorkReading | null, intentId: string): OwnerDispatchWork | null {
  const key = `dispatch:${intentId}`;
  const t = reading?.targets.find((x) => x.key === key) ?? null;
  if (t === null) return null;
  return {
    key,
    defined: t.requirements.defined,
    created: t.requirements.created,
    createdThisCycle: t.requirements.createdThisCycle,
    carried: t.requirements.carried,
    deferred: t.requirements.deferred,
    capped: t.requirements.capped,
    blockedUnits: t.units.blocked,
    blocked: t.blocked.map((b) => ({ code: b.code, says: `${b.why} (${b.dataset})` })),
  };
}

/* ---------------------------------------------------------- the targets */

/** A DISPATCH target from the owner's words (`fleet.deployHere`). */
export function dispatchWorkTarget(input: { readonly intentId: string; readonly note: string; readonly requestedAt: string }): DispatchWorkTarget {
  const target = parseDispatchTarget(input.note);
  return { kind: "DISPATCH", key: `dispatch:${input.intentId}`, label: target.text, requestedAt: input.requestedAt, ref: input.intentId, target };
}

/** A SCOPE target from a selected scope as the cycle planned it. */
export function scopeWorkTarget(scope: PlannedScope): DispatchWorkTarget {
  const d = scope.decision;
  return { kind: "SCOPE", key: d.key, label: d.geography.label, requestedAt: d.decidedAt, ref: d.receiptId, budgetUsd: d.budgetUsd, scope };
}

/**
 * The DISPATCH targets an earlier cycle left with work still owed (deferred,
 * or refused by the store), carried forward from the research state it wrote.
 * A DISPATCH is honored once; the remainder of what it owes is not dropped
 * with the honoring. A scope needs no carrying: it stays selected.
 */
export function carriedDispatchTargets(prior: unknown): DispatchWorkTarget[] {
  if (!isDispatchWorkReading(prior)) return [];
  return prior.targets
    .filter((t) => t.kind === "DISPATCH" && (t.requirements.deferred > 0 || t.requirements.failed > 0))
    .map((t) => dispatchWorkTarget({ intentId: t.ref, note: t.label, requestedAt: t.requestedAt }));
}

/** A value on the research state that is not a reading reads as none, never as an empty list. */
export function isDispatchWorkReading(value: unknown): value is DispatchWorkReading {
  return isVersionedCycleReading(value, DISPATCH_WORK_FORMAT_VERSION, "targets");
}
