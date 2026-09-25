/**
 * **WHICH WORK IS IN WHICH SCOPE, IN WHAT ORDER, AND WHETHER ITS BUDGET ALLOWS
 * ONE MORE PAID SCOUT.** (Expansion controls, 2026-09-23.)
 *
 * ## Membership is by CERTAIN overlap inside a shared ZCTA
 *
 * A scope is a set of ZCTAs (the Census geography lookup's `zctasForGrouping`:
 * every ZCTA wholly or partly inside it, each with its area share). A piece of
 * standing work is about one subject — the obligation's `subjectId`, which is
 * also the `jurisdiction` on every cost-ledger row it produced.
 *
 * Touching a common ZCTA is NOT enough: counties tile a state, so a county
 * shares every border ZCTA with its neighbours, and "Pima County" would
 * otherwise pull in Maricopa, Pinal, Cochise and Santa Cruz (measured on the
 * committed data). So a government is IN the scope only when the two must
 * overlap inside at least one ZCTA:
 *
 * ```
 *   the government touches a ZCTA that lies WHOLLY inside the scope, or
 *   inside one ZCTA, the government's share + the scope's share > 1 + margin
 *   (two parts of one ZCTA whose shares sum past the whole cannot be disjoint;
 *   the margin absorbs the difference between sampled and exact area)
 * ```
 *
 * A government's territory is the ZCTA set of the Census of Governments unit it
 * was enumerated from (`data/derived/census-unit-zips.json`), with its share of
 * each ZCTA from the same sampled overlap that built it
 * (`data/derived/zip-governments.json`, lattice samples per layer GEOID). The
 * registry ids are joined to those units by the registry generator's own id
 * rule (`scripts/enumerate-jurisdictions.mts`: `<state>:<class prefix>:<slug of
 * the Census name>`, `-<pid6>` on a name collision) — the same Census file, the
 * same derivation, never a fuzzy name match. A subject the join cannot place is
 * UNPLACED and counted as such; it is never guessed into a scope and never
 * reported as outside one.
 *
 * ZCTAs are not USPS ZIP codes, and overlap by area share is not a statement
 * about which residents a government serves. The page says both.
 *
 * ## Order
 *
 * The owner's explicit DISPATCH still goes first. After it, due rows in a
 * selected scope go ahead of everything else, the scope with priority 1 first;
 * a row in two scopes takes the better of the two. Within a scope the
 * existing order (oldest-due, or the Scout lane's reader-impact bands) stands.
 *
 * ## Budget
 *
 * A paid Scout for a subject in a scope is admitted only if that scope's
 * attributed rolling-24h model spend, plus what this cycle already spent or
 * reserved there, plus one Scout's worst case, stays within the scope's
 * budget — for EVERY scope the subject is in. A scope that cannot be resolved,
 * or whose spend is unmeasured, refuses paid work it cannot rule out: an
 * unresolved scope binds every subject in its state (and every subject whose
 * state is unknown), because it cannot tell what is inside it. The budget only
 * ever refuses; the Fleet's rolling ceiling is still checked first, elsewhere,
 * and nothing here raises it.
 *
 * PURE. Every input is handed in; nothing here reads a file, a store or a clock.
 */

import type { CostEntry } from "../cost.ts";
import { aggregateModelSpend } from "../fleet-safety.ts";
import type { Jurisdiction, JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";
import {
  MEMBERSHIP_METHOD,
  READING_LIST_CAP,
  type ExpansionCycleReading,
  type ExpansionScopeReading,
  type ScopeCoverageReading,
} from "./reading.ts";
import { certainlyOverlaps, type DivisionTerritory } from "./overlap.ts";
import type { ExpansionScopeDecision } from "./scopes.ts";
import { stateOfSubject } from "./subjects.ts";

/* ------------------------------------------------------------ territory */

/** One Census of Governments unit, as `data/derived/census-unit-zips.json` carries it. */
export interface CensusUnitTerritory {
  readonly pid6: string;
  readonly name: string;
  readonly type: string;
  readonly state: string;
  readonly zips: readonly string[];
  /** How its ZCTAs were derived, e.g. `county GEOID 04019`, `place GEOID 0477000`. */
  readonly method?: string;
}

/** A registered government whose territory is known. */
export interface Territory {
  readonly subjectId: string;
  readonly name: string;
  readonly govClass: string;
  readonly stateCode: string;
  readonly zctas: ReadonlySet<string>;
  /** The government's share (0..1) of each of its ZCTAs, where the sampled overlap records one. */
  readonly shares: ReadonlyMap<string, number>;
}

/* The certain-overlap rule itself lives in `overlap.ts` (so Admin's Send preview can apply it alone); re-exported here. */
export { OVERLAP_CERTAINTY_MARGIN, certainlyOverlaps, type DivisionTerritory } from "./overlap.ts";

/**
 * The sampled-overlap key a unit's ZCTAs were derived from (`county:04019`,
 * `place:0477000`, `unsd:…`), or null when its method names no single layer
 * GEOID (a county subdivision without one, a special district TIGER does not
 * publish).
 */
export function unitShareKey(unit: Pick<CensusUnitTerritory, "method">): string | null {
  const m = /^(county|place|cousub|unsd|elsd|scsd) GEOID (\d+)/.exec(unit.method ?? "");
  return m === null ? null : `${m[1]}:${m[2]}`;
}

/** The registry generator's own class and prefix rules, restated for the join (see the header). */
const CLASS_OF_CENSUS_TYPE: Readonly<Record<string, string>> = {
  COUNTY: "COUNTY",
  MUNICIPAL: "CITY_OR_TOWN",
  TOWNSHIP: "CITY_OR_TOWN",
  "SCHOOL DISTRICT": "SCHOOL_DISTRICT",
  "SPECIAL DISTRICT": "SPECIAL_DISTRICT",
  "DEPENDENT SCHOOL SYSTEM": "DEPENDENT_SCHOOL_SYSTEM",
};
const PREFIX_OF_CLASS: Readonly<Record<string, string>> = {
  STATE: "state",
  COUNTY: "county",
  CITY_OR_TOWN: "city",
  SCHOOL_DISTRICT: "school",
  DEPENDENT_SCHOOL_SYSTEM: "depschool",
  COMMUNITY_COLLEGE_DISTRICT: "cc",
  SPECIAL_DISTRICT: "special",
};

/** The registry generator's slug, character for character. */
export function registrySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

/** The registry id a Census unit would have been enumerated under, before any collision suffix. */
export function registryIdForUnit(unit: CensusUnitTerritory): string | null {
  const govClass = CLASS_OF_CENSUS_TYPE[unit.type];
  const prefix = govClass === undefined ? undefined : PREFIX_OF_CLASS[govClass];
  if (prefix === undefined) return null;
  return `${unit.state.toLowerCase()}:${prefix}:${registrySlug(unit.name)}`;
}

export interface TerritoryIndex {
  /** Registered governments with a known, non-empty territory, by subject id. */
  readonly bySubject: ReadonlyMap<string, Territory>;
  /** Registered governments the join could not place, and why. */
  readonly unplaced: ReadonlyMap<string, string>;
  /** Statewide subjects (the STATE rows): in no sub-state scope. */
  readonly statewide: ReadonlySet<string>;
  /** Census units in states NO registry covers, for the "not registered" count. Keyed by state (upper). */
  readonly unregisteredUnitsByState: ReadonlyMap<string, readonly CensusUnitTerritory[]>;
  /**
   * Census units in a state a registry DOES cover that no registry row joined:
   * a government the Census names and our registry does not carry (MW-028 names
   * them as blocked, never as work). Keyed by state (upper). Optional so an
   * index built before the field existed still reads.
   */
  readonly unjoinedUnitsByState?: ReadonlyMap<string, readonly CensusUnitTerritory[]>;
  /** A unit's share of each of its ZCTAs, where the sampled overlap was loaded for it. */
  readonly unitShares?: (unit: CensusUnitTerritory) => ReadonlyMap<string, number> | undefined;
}

/**
 * Join the covered-jurisdiction registries to the Census unit territories.
 *
 * `registries` are the promoted operational-reference registries the runner
 * already preloaded; `units` are every Census unit (any state), so a scope in
 * a state no registry covers can still say which governments it holds.
 * `sharesFor` answers a unit's per-ZCTA share by its `unitShareKey`; a unit
 * with none still joins, and can then only be placed by a whole-inside ZCTA.
 *
 * A registry read from a state's registration (2026-09-25) places each
 * government by the Census division registration minted its body on
 * (`divisionTerritory`: the same sampled overlap, read by the division's own
 * layer and GEOID, so it works for a territory the Census of Governments does
 * not enumerate), and still claims the Census unit its id joins, so no unit of
 * that state is named as missing from its registry. A government registration
 * pairs with no division is unplaced, by that name.
 */
export function buildTerritoryIndex(
  registries: readonly JurisdictionRegistry[],
  units: readonly CensusUnitTerritory[],
  sharesFor: (key: string) => ReadonlyMap<string, number> | undefined = () => undefined,
  divisionTerritory: (j: Jurisdiction) => DivisionTerritory | undefined = () => undefined,
): TerritoryIndex {
  const registeredStates = new Set(registries.map((r) => r.stateCode.toUpperCase()));
  const unitsByKey = new Map<string, CensusUnitTerritory[]>();
  const unregisteredUnitsByState = new Map<string, CensusUnitTerritory[]>();
  for (const unit of units) {
    const state = unit.state.toUpperCase();
    if (!registeredStates.has(state)) {
      const list = unregisteredUnitsByState.get(state) ?? [];
      list.push(unit);
      unregisteredUnitsByState.set(state, list);
      continue;
    }
    const key = registryIdForUnit(unit);
    if (key === null) continue;
    const list = unitsByKey.get(key) ?? [];
    list.push(unit);
    unitsByKey.set(key, list);
  }

  const bySubject = new Map<string, Territory>();
  const unplaced = new Map<string, string>();
  const statewide = new Set<string>();
  const claimed = new Set<CensusUnitTerritory>();
  for (const registry of registries) {
    const ids = new Set(registry.jurisdictions.map((j) => j.id));
    const fromRegistration = registry.registration?.kind === "REGISTRATION";
    for (const j of registry.jurisdictions) {
      if (j.govClass === "STATE") {
        statewide.add(j.id);
        continue;
      }
      let unit: CensusUnitTerritory | null = null;
      let why: string | null = null;
      const hits = unitsByKey.get(j.id) ?? [];
      if (hits.length === 1) unit = hits[0];
      else if (hits.length > 1) {
        // The generator suffixed every later duplicate with `-<pid6>`; the
        // unsuffixed id is the one unit no suffixed sibling claimed.
        const unclaimed = hits.filter((u) => !ids.has(`${j.id}-${u.pid6}`));
        unit = unclaimed.length === 1 ? unclaimed[0] : null;
        if (unit === null) why = `${hits.length} Census units share this name and none is uniquely this one`;
      } else {
        const suffixed = /^(.*)-(\d{3,})$/.exec(j.id);
        const base = suffixed === null ? [] : (unitsByKey.get(suffixed[1]) ?? []);
        unit = suffixed === null ? null : (base.find((u) => u.pid6 === suffixed[2]) ?? null);
        if (unit === null) why = "no Census of Governments unit with a territory matches this registry id";
      }
      if (fromRegistration) {
        /* Registration: the unit is claimed, and the government is placed by the division its body sits on. */
        if (unit !== null) claimed.add(unit);
        const t = j.ocdId ? divisionTerritory(j) : undefined;
        if (t === undefined || t.zctas.size === 0) {
          unplaced.set(
            j.id,
            j.ocdId
              ? "its Census division carries no ZCTA territory in the sampled overlap"
              : "registration pairs it with no Census division (TIGER publishes none for it, or none is uniquely its), so no body is minted for it",
          );
          continue;
        }
        bySubject.set(j.id, { subjectId: j.id, name: j.name, govClass: j.govClass, stateCode: j.stateCode.toUpperCase(), zctas: t.zctas, shares: t.shares });
        continue;
      }
      if (why !== null) unplaced.set(j.id, why);
      if (unit === null) continue;
      claimed.add(unit);
      if (unit.zips.length === 0) {
        unplaced.set(j.id, "its Census unit carries no ZCTA territory");
        continue;
      }
      const key = unitShareKey(unit);
      bySubject.set(j.id, {
        subjectId: j.id,
        name: j.name,
        govClass: j.govClass,
        stateCode: j.stateCode.toUpperCase(),
        zctas: new Set(unit.zips),
        shares: (key === null ? undefined : sharesFor(key)) ?? new Map<string, number>(),
      });
    }
  }
  const unjoinedUnitsByState = new Map<string, CensusUnitTerritory[]>();
  for (const unit of units) {
    const state = unit.state.toUpperCase();
    if (!registeredStates.has(state) || claimed.has(unit)) continue;
    const list = unjoinedUnitsByState.get(state) ?? [];
    list.push(unit);
    unjoinedUnitsByState.set(state, list);
  }
  const unitShares = (unit: CensusUnitTerritory): ReadonlyMap<string, number> | undefined => {
    const key = unitShareKey(unit);
    return key === null ? undefined : sharesFor(key);
  };
  return { bySubject, unplaced, statewide, unregisteredUnitsByState, unjoinedUnitsByState, unitShares };
}

/**
 * The Census units (of those given) that certainly overlap the scope, by the
 * same rule as a registered government: a whole-inside ZCTA, or shares that
 * sum past the whole. A unit whose shares were not loaded can only be placed by
 * a whole-inside ZCTA, so the count is a floor and never a guess.
 */
export function unitsCertainlyIn(
  scope: ScopeZctas,
  units: readonly CensusUnitTerritory[],
  sharesOf: (unit: CensusUnitTerritory) => ReadonlyMap<string, number> | undefined = () => undefined,
): CensusUnitTerritory[] {
  const none = new Map<string, number>();
  return units.filter((unit) => certainlyOverlaps({ zctas: new Set(unit.zips), shares: sharesOf(unit) ?? none }, scope));
}

/* ------------------------------------------------------------ resolution */

/** A selected scope with its ZCTAs resolved (or the named reason it is not). */
export type ResolvedScope =
  | {
      readonly kind: "RESOLVED";
      readonly decision: ExpansionScopeDecision;
      /** Every ZCTA wholly or partly inside the geography. */
      readonly zctas: ReadonlySet<string>;
      /** The ZCTAs lying wholly inside it. */
      readonly whole: ReadonlySet<string>;
      /** Each partial ZCTA's area share inside it, where the lookup states one. */
      readonly fractions: ReadonlyMap<string, number>;
      /** States the geography spans (the lookup's memberStates), upper-case. */
      readonly states: readonly string[];
    }
  | {
      readonly kind: "UNRESOLVED";
      readonly decision: ExpansionScopeDecision;
      readonly why: string;
      readonly states: readonly string[];
    };

/** The scope geometry the overlap rule reads. */
export type ScopeZctas = Pick<Extract<ResolvedScope, { kind: "RESOLVED" }>, "zctas" | "whole" | "fractions">;

/** The subjects (of those given) whose government certainly overlaps the scope. */
export function scopeMembers(
  scope: ScopeZctas,
  subjects: Iterable<string>,
  index: TerritoryIndex,
): Set<string> {
  const members = new Set<string>();
  for (const subject of subjects) {
    const territory = index.bySubject.get(subject);
    if (territory !== undefined && certainlyOverlaps(territory, scope)) members.add(subject);
  }
  return members;
}

/* ------------------------------------------------------------ order */

/**
 * A subject's placement: the index (0 = first) of the best-priority resolved
 * scope it is in, or null when it is in none. Scopes arrive in run order.
 */
export function placementIndex(
  scopes: readonly { readonly members: ReadonlySet<string> }[],
): (subjectId: string) => number | null {
  return (subjectId) => {
    for (let i = 0; i < scopes.length; i += 1) if (scopes[i].members.has(subjectId)) return i;
    return null;
  };
}

/**
 * Stable reorder: the owner's DISPATCH rows first, then rows in a scope by that
 * scope's run order, then everything else — each group keeping the order it
 * came in. Pure; never adds, drops or duplicates a row.
 */
export function orderByPlacement<T>(
  rows: readonly T[],
  rankOf: (row: T) => number | null,
): T[] {
  const ranked = rows.map((row, at) => ({ row, at, rank: rankOf(row) }));
  ranked.sort((a, b) => {
    const ra = a.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.rank ?? Number.POSITIVE_INFINITY;
    return ra === rb ? a.at - b.at : ra - rb;
  });
  return ranked.map((r) => r.row);
}

/* ------------------------------------------------------------ spend */

/** Attributed model spend for a scope's subjects in a window (the Fleet's own model-backed rule). */
export function scopeModelSpend(
  costs: readonly CostEntry[],
  members: ReadonlySet<string>,
  since: string,
  until: string,
): { readonly usd: number | null; readonly measured: number; readonly unmeasured: number } {
  return aggregateModelSpend(
    costs.filter((entry) => entry.jurisdiction !== null && members.has(entry.jurisdiction)),
    since,
    until,
  );
}

/* ------------------------------------------------------------ budget */

export const SCOPE_BUDGET_CODE = "SCOPE_BUDGET";

export interface BudgetScope {
  readonly key: string;
  readonly label: string;
  readonly budgetUsd: number;
  /** True when the scope's ZCTAs were resolved against the published lookup. */
  readonly resolved: boolean;
  /** The subjects in it (resolved scopes only). */
  readonly members: ReadonlySet<string>;
  /** States it spans, upper-case; binds unknown-state subjects too when unresolved. */
  readonly states: readonly string[];
  /** Attributed rolling-24h model spend at cycle start. Null when unmeasured or unresolved. */
  readonly historicalUsd: number | null;
}

export type BudgetAdmission =
  | { readonly admit: true }
  | { readonly admit: false; readonly code: typeof SCOPE_BUDGET_CODE; readonly why: string };

/**
 * The per-scope admission gate for paid Scouts.
 *
 * Reservations close the race between concurrent Scouts exactly as the Fleet
 * controller's do: an admitted Scout holds its worst case against every scope
 * it is in until its measured cost is settled. An admission that is never
 * settled keeps its reservation for the rest of the cycle — conservative,
 * because a budget may only restrict.
 */
export class ScopeBudgetGate {
  private readonly scopes: readonly BudgetScope[];
  private readonly worstCaseUsd: number;
  private readonly heldForMalformed: number;
  private readonly cycleUsd = new Map<string, number>();
  private readonly cycleUnmeasured = new Set<string>();
  private readonly reserved = new Map<string, number>();
  private readonly reservations = new Map<string, readonly string[]>();
  private readonly refusedBy = new Map<string, number>();
  private readonly admittedBy = new Map<string, number>();

  constructor(input: {
    readonly scopes: readonly BudgetScope[];
    readonly worstCaseUsd: number;
    /** Entries on the policy row that are not readable scopes: while > 0, every paid Scout is held. */
    readonly malformedScopes?: number;
  }) {
    this.scopes = input.scopes;
    this.worstCaseUsd = input.worstCaseUsd;
    this.heldForMalformed = input.malformedScopes ?? 0;
  }

  /** The scopes a subject is bound by. */
  bindingScopes(subjectId: string): BudgetScope[] {
    const state = stateOfSubject(subjectId);
    return this.scopes.filter((s) =>
      s.resolved ? s.members.has(subjectId) : state === null || s.states.includes(state),
    );
  }

  admit(obligationId: string, subjectId: string): BudgetAdmission {
    if (this.heldForMalformed > 0) {
      return {
        admit: false,
        code: SCOPE_BUDGET_CODE,
        why: `${this.heldForMalformed} selected scope(s) on the owner's policy row could not be read, so no scope budget can be checked; paid work is held until the scope list is readable`,
      };
    }
    const binding = this.bindingScopes(subjectId);
    for (const scope of binding) {
      if (!scope.resolved) {
        return this.refuse(scope, `${scope.label} could not be resolved against the published Census geography, so its $${scope.budgetUsd.toFixed(2)} budget cannot be checked; paid work it might contain is held`);
      }
      if (scope.historicalUsd === null || this.cycleUnmeasured.has(scope.key)) {
        return this.refuse(scope, `model spend in ${scope.label} is unmeasured, so its $${scope.budgetUsd.toFixed(2)} budget cannot be checked`);
      }
      const projected = scope.historicalUsd + (this.cycleUsd.get(scope.key) ?? 0) + (this.reserved.get(scope.key) ?? 0) + this.worstCaseUsd;
      if (projected > scope.budgetUsd) {
        const spent = scope.historicalUsd + (this.cycleUsd.get(scope.key) ?? 0);
        return this.refuse(
          scope,
          `${scope.label} has spent $${spent.toFixed(2)} of its $${scope.budgetUsd.toFixed(2)} rolling 24-hour budget; one more Scout's worst case ($${this.worstCaseUsd.toFixed(2)}) would exceed it`,
        );
      }
    }
    for (const scope of binding) {
      this.reserved.set(scope.key, (this.reserved.get(scope.key) ?? 0) + this.worstCaseUsd);
      this.admittedBy.set(scope.key, (this.admittedBy.get(scope.key) ?? 0) + 1);
    }
    this.reservations.set(obligationId, binding.map((s) => s.key));
    return { admit: true };
  }

  /** Release an admitted Scout's reservation and book what it measured (null = unmeasured). */
  settle(obligationId: string, usd: number | null): void {
    const keys = this.reservations.get(obligationId);
    if (keys === undefined) return;
    this.reservations.delete(obligationId);
    for (const key of keys) {
      this.reserved.set(key, Math.max(0, (this.reserved.get(key) ?? 0) - this.worstCaseUsd));
      if (usd === null || !Number.isFinite(usd)) this.cycleUnmeasured.add(key);
      else this.cycleUsd.set(key, (this.cycleUsd.get(key) ?? 0) + usd);
    }
  }

  refusedCount(key: string): number {
    return this.refusedBy.get(key) ?? 0;
  }

  admittedCount(key: string): number {
    return this.admittedBy.get(key) ?? 0;
  }

  private refuse(scope: BudgetScope, why: string): BudgetAdmission {
    this.refusedBy.set(scope.key, (this.refusedBy.get(scope.key) ?? 0) + 1);
    return { admit: false, code: SCOPE_BUDGET_CODE, why };
  }
}


/* ------------------------------------------------------------ the plan */

export interface ExpansionPlanInput {
  readonly now: string;
  readonly scopes: readonly ResolvedScope[];
  readonly malformedScopes: number;
  readonly lookup: ExpansionCycleReading["lookup"];
  /** Null when the territory index could not be built; every scope is then unresolved for membership. */
  readonly territory: TerritoryIndex | null;
  readonly territoryDetail: string | null;
  /** Every registered standing obligation: id and subject. */
  readonly obligations: readonly { readonly id: string; readonly subjectId: string }[];
}

export type PlannedScope = ResolvedScope & { readonly members: ReadonlySet<string> };

export interface ExpansionPlan {
  /** Run-ordered scopes with members (an unresolved scope carries none). */
  readonly scopes: readonly PlannedScope[];
  /** Placement for a subject: 0 = first scope; null = in no resolved scope. */
  readonly placementOf: (subjectId: string) => number | null;
  /** Every subject in any resolved scope. */
  readonly placedSubjects: ReadonlySet<string>;
  readonly malformedScopes: number;
  /** The reading at cycle start, before spend is known; `armExpansionBudget` adds spend and the budget verdicts. */
  readonly reading: ExpansionCycleReading;
}

const DAY_MS = 24 * 3_600_000;

function countBy<T>(items: Iterable<T>, keyOf: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[keyOf(item)] = (out[keyOf(item)] ?? 0) + 1;
  return out;
}

/**
 * What the scope holds: the registered governments that certainly overlap it,
 * which of them carry standing work, the scope ZCTAs a government with work
 * touches, and the rest (the gap). Census units in a state no registry covers
 * are counted by the same certain-overlap rule, with their sampled shares where
 * the index loaded them (every unit's, since 2026-09-23) and by the
 * whole-inside rule alone where it did not.
 */
function coverageOf(
  scope: ScopeZctas,
  states: readonly string[],
  index: TerritoryIndex,
  subjectsWithWork: ReadonlySet<string>,
): ScopeCoverageReading {
  const registered: Territory[] = [];
  for (const territory of index.bySubject.values()) {
    if (certainlyOverlaps(territory, scope)) registered.push(territory);
  }
  const withWork = registered.filter((t) => subjectsWithWork.has(t.subjectId));
  const covered = new Set<string>();
  for (const t of withWork) for (const z of t.zctas) if (scope.zctas.has(z)) covered.add(z);
  const gap = [...scope.zctas].filter((z) => !covered.has(z)).sort();
  const notRegistered: CensusUnitTerritory[] = [];
  for (const state of states) notRegistered.push(...unitsCertainlyIn(scope, index.unregisteredUnitsByState.get(state) ?? [], index.unitShares));
  return {
    registeredJurisdictions: registered.length,
    registeredByClass: countBy(registered, (t) => t.govClass),
    withWork: withWork.length,
    withWorkSample: withWork
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, READING_LIST_CAP)
      .map((t) => ({ subjectId: t.subjectId, name: t.name, govClass: t.govClass })),
    notRegisteredCensusUnits: notRegistered.length,
    notRegisteredByType: countBy(notRegistered, (u) => u.type),
    zctasWithLocalWork: covered.size,
    gapZctas: gap.length,
    gapSample: gap.slice(0, READING_LIST_CAP * 2),
  };
}

/** The pre-spend budget sentence an unresolved scope carries. */
function unresolvedBudgetSays(budgetUsd: number, states: readonly string[]): string {
  return (
    `Not resolved, so its $${budgetUsd.toFixed(2)} budget cannot be checked: paid work anywhere in ${states.join(", ")} ` +
    "(and work whose state is unknown) is held until it resolves. Removing the scope lifts the hold."
  );
}

/**
 * Step one, at the top of the cycle: membership, order and coverage. Needs no
 * spend, so it runs before the dispatch order is decided.
 */
export function planExpansion(input: ExpansionPlanInput): ExpansionPlan {
  const subjectsWithWork = new Set(input.obligations.map((o) => o.subjectId));
  const obligationsBySubject = new Map<string, number>();
  for (const o of input.obligations) obligationsBySubject.set(o.subjectId, (obligationsBySubject.get(o.subjectId) ?? 0) + 1);

  const scopes: PlannedScope[] = input.scopes.map((scope) => {
    if (scope.kind !== "RESOLVED" || input.territory === null) {
      const why =
        scope.kind === "UNRESOLVED"
          ? scope.why
          : `the territory index could not be built (${input.territoryDetail ?? "no detail"}), so nothing can be placed in it`;
      return { kind: "UNRESOLVED" as const, decision: scope.decision, why, states: scope.states, members: new Set<string>() };
    }
    return { ...scope, members: scopeMembers(scope, subjectsWithWork, input.territory) };
  });
  const placementOf = placementIndex(scopes.map((s) => ({ members: s.members })));
  const placedSubjects = new Set<string>();
  for (const s of scopes) for (const m of s.members) placedSubjects.add(m);

  const readings: ExpansionScopeReading[] = scopes.map((scope) => {
    const d = scope.decision;
    const base = {
      key: d.key,
      label: d.geography.label,
      type: d.geography.type,
      stateAbbr: d.geography.stateAbbr,
      priority: d.priority,
      budgetUsd: d.budgetUsd,
      heldThisCycle: null,
    };
    if (scope.kind !== "RESOLVED") {
      return {
        ...base,
        resolution: { kind: "UNRESOLVED" as const, why: scope.why },
        work: null,
        spend: null,
        coverage: null,
        budgetSays: unresolvedBudgetSays(d.budgetUsd, scope.states),
      };
    }
    const members = [...scope.members].sort();
    const subjectCap = READING_LIST_CAP * 8;
    return {
      ...base,
      resolution: { kind: "RESOLVED" as const, zctaCount: scope.zctas.size },
      work: {
        registeredObligations: members.reduce((n, s) => n + (obligationsBySubject.get(s) ?? 0), 0),
        subjects: members.length,
        subjectIds: members.slice(0, subjectCap),
        subjectIdsComplete: members.length <= subjectCap,
        dueThisCycle: 0,
        scoutRowsPlacedFirst: 0,
        scoutAdmitted: null,
      },
      spend: null,
      coverage: input.territory === null ? null : coverageOf(scope, scope.states, input.territory, subjectsWithWork),
      budgetSays: "Spend in this scope has not been read yet this cycle.",
    };
  });

  const territory = input.territory;
  const placed = territory === null ? 0 : [...subjectsWithWork].filter((s) => territory.bySubject.has(s)).length;
  const statewideSubjects = territory === null ? 0 : [...subjectsWithWork].filter((s) => territory.statewide.has(s)).length;
  const reading: ExpansionCycleReading = {
    formatVersion: 1,
    at: input.now,
    lookup: input.lookup,
    territory: {
      method: MEMBERSHIP_METHOD,
      registeredObligations: input.obligations.length,
      placedSubjects: placed,
      unplacedSubjects: territory === null ? subjectsWithWork.size : subjectsWithWork.size - placed - statewideSubjects,
      statewideSubjects,
      detail: input.territoryDetail,
    },
    malformedScopes: input.malformedScopes,
    scopes: readings,
    orderSays:
      "The owner's DISPATCH goes first. Then, in the Scout (paid) lane, due work in a selected scope goes ahead of the rest, priority 1 first; " +
      "in the plain-code lane every selected scope's due work goes ahead of the rest together, oldest-due first (a cycle with a pending " +
      "DISPATCH orders that lane by the DISPATCH alone). The order adds, skips and makes due nothing; what a scope is missing is created " +
      "separately, from the registry's own requirements, bounded and counted.",
  };
  return { scopes, placementOf, placedSubjects, malformedScopes: input.malformedScopes, reading };
}

/**
 * Step two, once the cost ledger is read: each scope's attributed spend, the
 * budget verdict, and the gate the Scout admission consults. `costs` null means
 * the ledger could not be read — every budgeted scope then holds its paid work.
 */
export function armExpansionBudget(
  plan: ExpansionPlan,
  input: { readonly now: string; readonly costs: readonly CostEntry[] | null; readonly worstCaseUsd: number },
): { readonly gate: ScopeBudgetGate; readonly reading: ExpansionCycleReading } {
  const since24 = new Date(Date.parse(input.now) - DAY_MS).toISOString();
  const since7 = new Date(Date.parse(input.now) - 7 * DAY_MS).toISOString();
  const budgetScopes: BudgetScope[] = [];
  const readings = plan.reading.scopes.map((reading, i) => {
    const scope = plan.scopes[i];
    const d = scope.decision;
    if (scope.kind !== "RESOLVED") {
      budgetScopes.push({ key: d.key, label: d.geography.label, budgetUsd: d.budgetUsd, resolved: false, members: scope.members, states: scope.states, historicalUsd: null });
      return reading;
    }
    const spend24 = input.costs === null ? null : scopeModelSpend(input.costs, scope.members, since24, input.now);
    const spend7 = input.costs === null ? null : scopeModelSpend(input.costs, scope.members, since7, input.now);
    budgetScopes.push({
      key: d.key,
      label: d.geography.label,
      budgetUsd: d.budgetUsd,
      resolved: true,
      members: scope.members,
      states: scope.states,
      historicalUsd: spend24 === null ? null : spend24.usd,
    });
    return {
      ...reading,
      spend:
        spend24 === null || spend7 === null
          ? null
          : {
              rolling24hUsd: spend24.usd,
              sevenDayUsd: spend7.usd,
              measuredRows24h: spend24.measured,
              unmeasuredRows24h: spend24.unmeasured,
              measuredRows7d: spend7.measured,
              unmeasuredRows7d: spend7.unmeasured,
            },
      budgetSays:
        spend24 === null
          ? `The cost ledger could not be read, so the $${d.budgetUsd.toFixed(2)} budget cannot be checked: paid work in this scope is held.`
          : spend24.usd === null
            ? `${spend24.unmeasured} model row(s) in this scope reported no dollar figure, so the $${d.budgetUsd.toFixed(2)} budget cannot be checked: paid work here is held.`
            : spend24.usd + input.worstCaseUsd > d.budgetUsd
              ? `$${spend24.usd.toFixed(2)} spent in the rolling 24 hours of a $${d.budgetUsd.toFixed(2)} budget: one more Scout would exceed it, so paid work here is held.`
              : `$${spend24.usd.toFixed(2)} spent in the rolling 24 hours of a $${d.budgetUsd.toFixed(2)} budget: room for paid work here, when the paid lane is open.`,
    };
  });
  const gate = new ScopeBudgetGate({ scopes: budgetScopes, worstCaseUsd: input.worstCaseUsd, malformedScopes: plan.malformedScopes });
  return { gate, reading: { ...plan.reading, scopes: readings } };
}

/** The reading with this cycle's dispatch counts filled in. Pure. */
export function withCycleCounts(
  reading: ExpansionCycleReading,
  counts: {
    readonly dueByScope: ReadonlyMap<string, number>;
    readonly scoutPlacedFirstByScope: ReadonlyMap<string, number>;
    readonly gate: ScopeBudgetGate | null;
  },
): ExpansionCycleReading {
  return {
    ...reading,
    scopes: reading.scopes.map((s) => ({
      ...s,
      heldThisCycle: counts.gate === null ? null : counts.gate.refusedCount(s.key),
      work:
        s.work === null
          ? null
          : {
              ...s.work,
              dueThisCycle: counts.dueByScope.get(s.key) ?? 0,
              scoutRowsPlacedFirst: counts.scoutPlacedFirstByScope.get(s.key) ?? 0,
              scoutAdmitted: counts.gate === null ? null : counts.gate.admittedCount(s.key),
            },
    })),
  };
}

/** Per-scope counts of rows (by obligation subject) — for the due and placed-first tallies. */
export function countByScope(
  plan: ExpansionPlan,
  subjects: Iterable<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const subject of subjects) {
    for (const scope of plan.scopes) {
      if (scope.members.has(subject)) out.set(scope.decision.key, (out.get(scope.decision.key) ?? 0) + 1);
    }
  }
  return out;
}
