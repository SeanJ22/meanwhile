/**
 * Which work is in which scope, in what order, and whether its budget allows
 * one more paid Scout.
 *
 * A scope is a set of ZCTAs (`zctasForGrouping`, each with its area share).
 * Touching a common ZCTA is not enough (counties tile a state and share border
 * ZCTAs), so a government is in the scope only when the two must overlap:
 *
 * ```
 *   the government touches a ZCTA that lies wholly inside the scope, or
 *   inside one ZCTA, the government's share + the scope's share > 1 + margin
 *   (the margin absorbs the difference between sampled and exact area)
 * ```
 *
 * A government's territory is its Census of Governments unit's ZCTA set, with
 * sampled shares. Registry ids join units by the registry generator's own id
 * rule (`<state>:<class prefix>:<slug>`, `-<pid6>` on collision), never a fuzzy
 * name match. A subject the join cannot place is UNPLACED, never guessed.
 * ZCTAs are not USPS ZIP codes.
 *
 * Order: the owner's DISPATCH first, then due rows in a selected scope by
 * scope priority (a row in two scopes takes the better), each keeping its
 * existing order.
 *
 * Budget: a paid Scout is admitted only if, for every scope the subject is in,
 * attributed rolling-24h spend + this cycle's spend and reservations + one
 * worst case fits the scope's budget. An unresolved or unmeasured scope binds
 * every subject in its state (and unknown-state subjects). The budget only
 * restricts; the Fleet ceiling is checked elsewhere.
 *
 * Pure. Every input is handed in.
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
import { DISTRICT_TERRITORIES, ruledDistrictTerritory } from "./district-territory.ts";
import { certainlyOverlaps, type DivisionTerritory } from "./overlap.ts";
import type { ExpansionScopeDecision } from "./scopes.ts";
import { areaBudgetKey, type BudgetLine } from "./spend-holds.ts";
import { stateOfSubject } from "./subjects.ts";
import { isFundedHunt } from "../scheduler/hunt-continuation.ts";

/* ------------------------------------------------------------ territory */

/** One Census of Governments unit, as `data/derived/census-unit-zips.json` carries it. */
export interface CensusUnitTerritory {
  readonly pid6: string;
  readonly name: string;
  readonly type: string;
  readonly state: string;
  readonly zips: readonly string[];
  /** How its ZCTAs were derived, e.g. `county GEOID <ssccc>`, `place GEOID <sspppp>`. */
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
 * The sampled-overlap key a unit's ZCTAs were derived from (`county:<geoid>`,
 * `place:<geoid>`, `unsd:…`), or null when its method names no single layer GEOID.
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
  /** Held OCD identity bridges for shared candidate/source work. */
  readonly byDivision?: ReadonlyMap<string, DivisionTerritory>;
  /** Statewide subjects (the STATE rows), reused by applicable sub-state scopes. */
  readonly statewide: ReadonlySet<string>;
  /** Census units in states NO registry covers, for the "not registered" count. Keyed by state (upper). */
  readonly unregisteredUnitsByState: ReadonlyMap<string, readonly CensusUnitTerritory[]>;
  /**
   * Census units in a covered state that no registry row joined: governments the
   * registry does not carry, counted as blocked, never as work. Keyed by state
   * (upper). Optional for older indexes.
   */
  readonly unjoinedUnitsByState?: ReadonlyMap<string, readonly CensusUnitTerritory[]>;
  /** A unit's share of each of its ZCTAs, where the sampled overlap was loaded for it. */
  readonly unitShares?: (unit: CensusUnitTerritory) => ReadonlyMap<string, number> | undefined;
}

/**
 * Join the covered-jurisdiction registries to the Census unit territories.
 * `units` covers every state, so a scope in an unregistered state can still say
 * which governments it holds. A unit without shares can only be placed by a
 * whole-inside ZCTA.
 *
 * A registration-read registry places each government by the Census division
 * its body sits on (`divisionTerritory`), and still claims the Census unit its
 * id joins. A government paired with no division is unplaced, by name.
 */
export function buildTerritoryIndex(
  registries: readonly JurisdictionRegistry[],
  units: readonly CensusUnitTerritory[],
  sharesFor: (key: string) => ReadonlyMap<string, number> | undefined = () => undefined,
  divisionTerritory: (j: Jurisdiction) => DivisionTerritory | undefined = () => undefined,
): TerritoryIndex {
  const registeredStates = new Set(registries.map((r) => r.stateCode.toUpperCase()));
  const unitsByPid = new Map(units.map((u) => [`${u.state.toUpperCase()}:${u.pid6}`, u] as const));
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
        /* A district TIGER draws no boundary for may still have one its own law gives (`district-territory.ts`). */
        const ruled = ruledDistrictTerritory(unit, unitsByPid, sharesFor, unitShareKey, DISTRICT_TERRITORIES);
        if (ruled !== null && !("unplaced" in ruled)) {
          bySubject.set(j.id, { subjectId: j.id, name: j.name, govClass: j.govClass, stateCode: j.stateCode.toUpperCase(), zctas: ruled.zctas, shares: ruled.shares });
          continue;
        }
        unplaced.set(j.id, ruled === null ? "its Census unit carries no ZCTA territory" : `its Census unit carries no ZCTA territory, and ${ruled.unplaced}`);
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
  const byDivision = new Map<string, DivisionTerritory>();
  for (const registry of registries) for (const j of registry.jurisdictions) {
    const territory = bySubject.get(j.id);
    if (!j.ocdId || !territory) continue;
    const prior = byDivision.get(j.ocdId);
    if (!prior) byDivision.set(j.ocdId, territory);
    else {
      const shares = new Map(prior.shares);
      for (const [zcta, share] of territory.shares) shares.set(zcta, Math.max(shares.get(zcta) ?? 0, share));
      byDivision.set(j.ocdId, { zctas: new Set([...prior.zctas, ...territory.zctas]), shares });
    }
  }
  return { bySubject, byDivision, unplaced, statewide, unregisteredUnitsByState, unjoinedUnitsByState, unitShares };
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
  readonly lifetime?: boolean;
  readonly budgetStartedAt?: string;
  readonly receiptId?: string;
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
 * The per-scope admission gate for paid Scouts. An admitted Scout holds its
 * worst case against every scope it is in until settled; an unsettled
 * admission keeps its reservation for the rest of the cycle.
 */
/** A state hint as a state: a bare postal code (`AZ`) or any id `stateOfSubject` reads; null when it says none. */
function stateOfHint(hint: string | null | undefined): string | null {
  if (typeof hint !== "string" || hint.trim() === "") return null;
  const h = hint.trim();
  return /^[a-z]{2}$/i.test(h) ? stateOfSubject(`${h}:state`) : stateOfSubject(h);
}

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

  private readonly historyReadAt: string;

  constructor(input: {
    readonly scopes: readonly BudgetScope[];
    readonly worstCaseUsd: number;
    /** Entries on the policy row that are not readable scopes: while > 0, every paid Scout is held. */
    readonly malformedScopes?: number;
    /** When the scopes' historical spend was read (the cycle's instant). */
    readonly historyReadAt?: string;
  }) {
    this.scopes = input.scopes;
    this.worstCaseUsd = input.worstCaseUsd;
    this.heldForMalformed = input.malformedScopes ?? 0;
    this.historyReadAt = input.historyReadAt ?? new Date(0).toISOString();
  }

  /** What this gate was armed with, for the standing hunter lane's reading. */
  armedReading(): { readonly scopes: readonly BudgetScope[]; readonly malformedScopes: number } {
    return { scopes: this.scopes, malformedScopes: this.heldForMalformed };
  }

  /** The scopes a subject is bound by. `stateHint` is read only when the subject's own id does not say its state. */
  bindingScopes(subjectId: string, stateHint?: string | null): BudgetScope[] {
    const state = stateOfSubject(subjectId) ?? stateOfHint(stateHint);
    return this.scopes.filter((s) =>
      s.resolved ? s.members.has(subjectId) : state === null || s.states.includes(state),
    );
  }

  /** Funded Sends supersede overlapping rolling scopes; each keeps its own allowance. */
  private effectiveScopes(binding: readonly BudgetScope[]): readonly BudgetScope[] {
    const funded = binding.filter(isFundedHunt);
    return funded.length ? funded : binding;
  }

  /** A selected hunt authorizes its own work, including explicitly shared
   * members. Opening the model lane for that hunt must not start unrelated
   * geographic acquisition. Legacy rolling-only selections keep their rules. */
  private outsideSelectedHunts(binding: readonly BudgetScope[]): Extract<BudgetAdmission, { admit: false }> | null {
    return this.scopes.some(scope => scope.lifetime) && !binding.some(scope => scope.lifetime)
      ? { admit: false, code: SCOPE_BUDGET_CODE, why: "This work is outside the selected hunts. Paid model acquisition waits for an applicable hunt instruction; plain-code work is unchanged." }
      : null;
  }

  /**
   * The area budget lines a paid job on this subject is held against
   * (`spend-holds.ts`): every binding scope must have room, or the refusal when
   * a scope's budget cannot be checked. No lines: no area budget applies.
   */
  linesFor(subjectId: string, stateHint?: string | null): { readonly lines: readonly BudgetLine[] } | { readonly refusal: Extract<BudgetAdmission, { admit: false }> } {
    if (this.heldForMalformed > 0) {
      return {
        refusal: {
          admit: false,
          code: SCOPE_BUDGET_CODE,
          why: `${this.heldForMalformed} selected scope(s) on the owner's policy row could not be read, so no scope budget can be checked; paid work is held until the scope list is readable`,
        },
      };
    }
    const binding = this.bindingScopes(subjectId, stateHint);
    const outside = this.outsideSelectedHunts(binding);
    if (outside !== null) return { refusal: outside };
    const lines: BudgetLine[] = [];
    for (const scope of this.effectiveScopes(binding)) {
      if (!scope.resolved) {
        return { refusal: this.refuse(scope, `${scope.label} could not be resolved against the published Census geography, so its $${scope.budgetUsd.toFixed(2)} budget cannot be checked; paid work it might contain is held`) as Extract<BudgetAdmission, { admit: false }> };
      }
      if (scope.historicalUsd === null || this.cycleUnmeasured.has(scope.key)) {
        return { refusal: this.refuse(scope, `model spend in ${scope.label} is unmeasured, so its $${scope.budgetUsd.toFixed(2)} budget cannot be checked`) as Extract<BudgetAdmission, { admit: false }> };
      }
      lines.push({ key: areaBudgetKey(scope.budgetStartedAt ? `${scope.key}@${scope.budgetStartedAt}` : scope.key), label: scope.label, budgetUsd: scope.budgetUsd, historicalUsd: scope.historicalUsd, historyReadAt: this.historyReadAt, lifetime: scope.lifetime });
    }
    return { lines };
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
    const outside = this.outsideSelectedHunts(binding);
    if (outside !== null) return outside;
    const effective = this.effectiveScopes(binding);
    for (const scope of effective) {
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
          `${scope.label} has spent $${spent.toFixed(2)} of its $${scope.budgetUsd.toFixed(2)} ${scope.lifetime ? "Anthropic token budget for this hunt" : "rolling 24-hour budget"}; one more Scout's worst case ($${this.worstCaseUsd.toFixed(2)}) would exceed it`,
        );
      }
    }
    for (const scope of effective) {
      this.reserved.set(scope.key, (this.reserved.get(scope.key) ?? 0) + this.worstCaseUsd);
      this.admittedBy.set(scope.key, (this.admittedBy.get(scope.key) ?? 0) + 1);
    }
    this.reservations.set(obligationId, effective.map((s) => s.key));
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
  readonly declaredMembers?: ReadonlyMap<string, ReadonlySet<string>>;
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
 * which carry standing work, the scope ZCTAs those touch, and the gap. Census
 * units in unregistered states are counted by the same rule.
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
    const members = scopeMembers(scope, subjectsWithWork, input.territory);
    for (const subject of input.declaredMembers?.get(scope.decision.key) ?? []) members.add(subject);
    for (const subject of input.territory.statewide) if (scope.states.includes(stateOfSubject(subject) ?? "")) members.add(subject);
    return { ...scope, members };
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
  const declaredPlaced = new Set([...(input.declaredMembers?.values() ?? [])].flatMap(members => [...members]));
  const placed = territory === null ? 0 : [...subjectsWithWork].filter((s) => !territory.statewide.has(s) && (territory.bySubject.has(s) || declaredPlaced.has(s))).length;
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
      budgetScopes.push({ key: d.key, label: d.geography.label, budgetUsd: d.budgetUsd, resolved: false, members: scope.members, states: scope.states, historicalUsd: null,
        lifetime: Boolean(d.budgetStartedAt), budgetStartedAt: d.budgetStartedAt, receiptId: d.receiptId });
      return reading;
    }
    const spend24 = input.costs === null ? null : scopeModelSpend(input.costs, scope.members, since24, input.now);
    const budgetSpend = d.budgetStartedAt && input.costs !== null ? scopeModelSpend(input.costs, scope.members, d.budgetStartedAt, input.now) : spend24;
    const period = d.budgetStartedAt ? "for this hunt (Anthropic tokens)" : "in the rolling 24 hours";
    const spend7 = input.costs === null ? null : scopeModelSpend(input.costs, scope.members, since7, input.now);
    budgetScopes.push({
      key: d.key,
      label: d.geography.label,
      budgetUsd: d.budgetUsd,
      resolved: true,
      members: scope.members,
      states: scope.states,
      historicalUsd: budgetSpend === null ? null : budgetSpend.usd,
      lifetime: Boolean(d.budgetStartedAt),
      budgetStartedAt: d.budgetStartedAt,
      receiptId: d.receiptId,
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
        budgetSpend === null
          ? `The cost ledger could not be read, so the $${d.budgetUsd.toFixed(2)} budget cannot be checked: paid work in this scope is held.`
          : budgetSpend.usd === null
            ? `${budgetSpend.unmeasured} model row(s) in this scope reported no dollar figure, so the $${d.budgetUsd.toFixed(2)} budget cannot be checked: paid work here is held.`
            : budgetSpend.usd + input.worstCaseUsd > d.budgetUsd
              ? `$${budgetSpend.usd.toFixed(2)} spent ${period} of a $${d.budgetUsd.toFixed(2)} budget: one more Scout would exceed it, so paid work here is held.`
              : `$${budgetSpend.usd.toFixed(2)} spent ${period} of a $${d.budgetUsd.toFixed(2)} budget: room for paid work here, when the paid lane is open.`,
    };
  });
  const gate = new ScopeBudgetGate({ scopes: budgetScopes, worstCaseUsd: input.worstCaseUsd, malformedScopes: plan.malformedScopes, historyReadAt: input.now });
  return { gate, reading: { ...plan.reading, scopes: readings } };
}

/** The reading with this cycle's dispatch counts filled in. Pure. */
export function withCycleCounts(
  reading: ExpansionCycleReading,
  counts: {
    readonly dueByScope: ReadonlyMap<string, number>;
    readonly dispatchedByScope?: ReadonlyMap<string, number>;
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
              ...(counts.dispatchedByScope ? { dispatchedThisCycle: counts.dispatchedByScope.get(s.key) ?? 0 } : {}),
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
