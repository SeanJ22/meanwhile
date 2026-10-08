/**
 * The runner's reads for the expansion scopes: the published Census geography
 * lookup (one load per cycle; anything but a "published" source resolves
 * nothing) and the Census unit territories from data/derived/place-reference/.
 * The territory index is returned with the plan so it is read once per cycle.
 *
 * Server-only.
 */

import type { CensusGeographyLookup, GeographyType } from "../../census-geography/contract.ts";
import { loadPublishedLookupState, type PublishedLookupSource } from "../../census-geography/reader.ts";
import { installedOperationalReferenceRegistries } from "../../civic-data/operational-references.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";
import {
  buildTerritoryIndex,
  planExpansion,
  unitShareKey,
  registryIdForUnit,
  type CensusUnitTerritory,
  type ExpansionPlan,
  type ResolvedScope,
  type TerritoryIndex,
} from "./membership.ts";
import type { ExpansionCycleReading } from "./reading.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "./scopes.ts";
import { declaredWorkMembers, type ScopedStandingWork } from "./declared-work-scope.ts";
import { divisionsForZip, heldDivisionsForZip, type PlaceDivision } from "./national-geography.ts";
import { readStateReference } from "./state-references.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";

/**
 * Each wanted government's share of each of its ZCTAs, from the sampled
 * overlap: the government's lattice samples in the ZCTA over the ZCTA's
 * samples across the county layer (counties tile the land, so that is every
 * sample in the ZCTA). Only the keys asked for are kept.
 */
export function readZctaShares(root: string, wanted: ReadonlySet<string>, states?: readonly string[]): Map<string, Map<string, number>> {
  const selected = states ?? [...new Set([...wanted].flatMap(key => FIPS_TO_STATE[key.split(":")[1]?.slice(0, 2)]?.postal ?? []))];
  const out = new Map<string, Map<string, number>>();
  for (const state of selected) {
    const shard = readStateReference(root, state, { shares: wanted });
    for (const [zcta, { edges, total }] of Object.entries(shard.zips)) {
      if (total <= 0) continue;
      for (const edge of edges) {
        const key = `${edge.layer}:${edge.id}`;
        if (!wanted.has(key)) continue;
        const shares = out.get(key) ?? new Map<string, number>();
        shares.set(zcta, Math.min(1, edge.samples / total));
        out.set(key, shares);
      }
    }
    for (const [key, entries] of Object.entries(shard.exactShares)) {
      if (!wanted.has(key)) continue;
      const shares = out.get(key) ?? new Map<string, number>();
      for (const [zip, share] of Object.entries(entries)) shares.set(zip, share);
      out.set(key, shares);
    }
  }
  return out;
}

/**
 * The territory index the runner uses: the preloaded registries, the committed
 * units and their sampled shares, for every unit whether or not its state has a
 * registry.
 */
export function readTerritoryIndex(root: string, registries: readonly JurisdictionRegistry[], states = [...new Set(registries.map(registry => registry.stateCode))], zips?: ReadonlySet<string>, places: ReadonlyMap<string, readonly PlaceDivision[]> = new Map()): TerritoryIndex {
  const selected = new Set(states.map(state => state.toUpperCase()));
  const exact = new Map<string, Set<string>>();
  for (const [zip, divisions] of places) for (const division of divisions) {
    const layer = division.censusLayer ?? division.divisionType;
    if (zips && !zips.has(zip) || !["county", "place", "cousub", "unsd", "elsd", "scsd"].includes(layer) ||
      !selected.has(FIPS_TO_STATE[division.geoid.slice(0, 2)]?.postal ?? "")) continue;
    const key = `${layer}:${division.geoid}`;
    const touched = exact.get(key) ?? new Set<string>();
    touched.add(zip); exact.set(key, touched);
  }
  const units = readCensusUnitTerritories(root, states, zips, new Set(exact.keys())).map(unit => {
    const touched = exact.get(unitShareKey(unit) ?? "");
    return touched ? { ...unit, zips: [...new Set([...unit.zips, ...touched])] } : unit;
  });
  const wanted = new Set<string>(exact.keys());
  for (const unit of units) {
    const key = unitShareKey(unit);
    if (key !== null) wanted.add(key);
  }
  const unitIds = new Set(units.flatMap(unit => {
    const id = registryIdForUnit(unit);
    return id ? [id, `${id}-${unit.pid6}`] : [];
  }));
  const scopedRegistries = registries.filter(registry => selected.has(registry.stateCode.toUpperCase())).map(registry => zips ? {
    ...registry, jurisdictions: registry.jurisdictions.filter(j => j.govClass === "STATE" || unitIds.has(j.id) || Boolean(j.censusDivision && wanted.has(j.censusDivision))),
  } : registry);
  /* A registration-read registry places each government by its body's division, by that division's own layer and GEOID. */
  for (const registry of scopedRegistries) {
    if (registry.registration?.kind !== "REGISTRATION") continue;
    for (const j of registry.jurisdictions) if (j.censusDivision) wanted.add(j.censusDivision);
  }
  const shares = readZctaShares(root, wanted, states);
  for (const key of shares.keys()) if (!selected.has(FIPS_TO_STATE[key.split(":")[1]?.slice(0, 2)]?.postal ?? "")) shares.delete(key);
  return buildTerritoryIndex(scopedRegistries, units, (key) => shares.get(key), (j) => {
    const own = j.censusDivision ? shares.get(j.censusDivision) : undefined;
    const touched = j.censusDivision ? exact.get(j.censusDivision) : undefined;
    return own === undefined && !touched ? undefined : { zctas: new Set([...(own?.keys() ?? []), ...(touched ?? [])]), shares: own ?? new Map() };
  });
}

/** Read the Census unit territories. Throws with the path named; the caller turns that into a named condition. */
export function readCensusUnitTerritories(root: string, states: readonly string[], zips?: ReadonlySet<string>, divisions?: ReadonlySet<string>): readonly CensusUnitTerritory[] {
  const selected = new Set(states.map(state => state.toUpperCase()));
  const units = [...selected].flatMap(state => {
    return readStateReference(root, state, { units: zips ?? "state", divisions }).units;
  });
  return units;
}

/**
 * A whole state is the union of its counties' ZIP areas, because the lookup has no state container and counties tile a
 * state without a gap. A ZIP that sits inside the state in more than one county is wholly in it; a ZIP in one county only keeps
 * that county's share. The state plan version follows the county plan it was built from.
 */
export async function resolveStateScope(decision: ExpansionScopeDecision, lookup: CensusGeographyLookup): Promise<ResolvedScope> {
  const g = decision.geography;
  const counties = await lookup.enumerateGroupings("county");
  const countyYear = counties.version.key.split(":")[1];
  if (g.version !== `state:${countyYear}`) {
    return { kind: "UNRESOLVED", decision, why: `the published county plan is ${counties.version.key}, so only the state:${countyYear} plan can be resolved from it`, states: [g.stateAbbr] };
  }
  const inState = counties.instances.filter(c => c.stateAbbr.toUpperCase() === g.stateAbbr.toUpperCase());
  if (inState.length === 0) return { kind: "UNRESOLVED", decision, why: "the published lookup holds no counties for this state", states: [g.stateAbbr] };
  const seen = new Map<string, { whole: boolean; fraction: number | null; counties: number }>();
  for (const county of inState) {
    const result = await lookup.zctasForGrouping({ type: "county", geoid: county.geoid, version: county.version });
    if (result.status.kind !== "OK") return { kind: "UNRESOLVED", decision, why: `a county of this state could not be read (${result.status.note})`, states: [g.stateAbbr] };
    for (const o of result.overlaps) {
      const prior = seen.get(o.zcta5);
      seen.set(o.zcta5, { whole: (prior?.whole ?? false) || o.whole, fraction: o.whole ? null : o.fraction, counties: (prior?.counties ?? 0) + 1 });
    }
  }
  const zctas = new Set(seen.keys());
  const whole = new Set([...seen].filter(([, v]) => v.whole || v.counties > 1).map(([zcta]) => zcta));
  const fractions = new Map([...seen].filter(([, v]) => !v.whole && v.counties === 1 && v.fraction !== null).map(([zcta, v]) => [zcta, v.fraction as number] as const));
  return { kind: "RESOLVED", decision, zctas, whole, fractions, states: [g.stateAbbr.toUpperCase()] };
}

/**
 * Resolve every selected scope's ZCTAs against the lookup the caller loaded
 * once. A scope that cannot be resolved says why, by name; it never resolves
 * to an empty set that would read as "nothing is in it".
 */
export async function resolveScopes(
  decisions: readonly ExpansionScopeDecision[],
  state: { readonly lookup: CensusGeographyLookup; readonly source: PublishedLookupSource; readonly versionId: string } | null,
  unreadable: string | null,
): Promise<{ readonly scopes: readonly ResolvedScope[]; readonly lookup: ExpansionCycleReading["lookup"] }> {
  if (state === null) {
    return {
      scopes: decisions.map((decision) => ({
        kind: "UNRESOLVED" as const,
        decision,
        why: `the Census geography lookup could not be read (${unreadable ?? "no detail"})`,
        states: [decision.geography.stateAbbr],
      })),
      lookup: { source: "NOT_READ", versionId: null, detail: unreadable },
    };
  }
  const lookupReading: ExpansionCycleReading["lookup"] = { source: state.source, versionId: state.versionId, detail: null };
  if (state.source !== "published") {
    return {
      scopes: decisions.map((decision) => ({
        kind: "UNRESOLVED" as const,
        decision,
        why:
          state.source === "bootstrap"
            ? "only the bundled Arizona test fixture is available, which is not the published Census geography"
            : "the Census geography is not published yet",
        states: [decision.geography.stateAbbr],
      })),
      lookup: lookupReading,
    };
  }
  const scopes: ResolvedScope[] = [];
  for (const decision of decisions) {
    const g = decision.geography;
    try {
      if (g.type === "zcta") {
        const [result, manifest] = await Promise.all([state.lookup.groupingsForZcta(g.geoid), state.lookup.manifest()]);
        const vintages = new Set(manifest.versions.map(v => `zcta:${v.zctaTabulation}`));
        if (result.status.kind !== "OK" || !vintages.has(g.version)) {
          scopes.push({ kind: "UNRESOLVED", decision, why: result.status.kind !== "OK" ? result.status.note : "The selected Census ZCTA vintage is not published.", states: [g.stateAbbr] });
        } else {
          // A metro can span states this ZIP does not touch. Counties partition
          // the ZIP itself; the metro's other member states are not its scope.
          const states = [...new Set(result.memberships.filter(m => m.geography.type === "county").map(m => m.geography.stateAbbr.toUpperCase()))];
          if (states.length === 0) throw new Error("The published ZIP has no county membership to establish its states.");
          scopes.push({ kind: "RESOLVED", decision, zctas: new Set([g.geoid]), whole: new Set([g.geoid]), fractions: new Map(), states });
        }
        continue;
      }
      if (g.type === "state") {
        scopes.push(await resolveStateScope(decision, state.lookup));
        continue;
      }
      const result = await state.lookup.zctasForGrouping({ type: g.type as GeographyType, geoid: g.geoid, version: g.version });
      if (result.status.kind !== "OK") {
        scopes.push({
          kind: "UNRESOLVED",
          decision,
          why:
            result.status.kind === "NOT_YET_PUBLISHED"
              ? `this plan version is not published yet (${result.status.note})`
              : result.status.note,
          states: [g.stateAbbr],
        });
        continue;
      }
      const states = [...new Set([g.stateAbbr, ...result.geography.memberStates].map((s) => s.toUpperCase()))];
      const fractions = new Map<string, number>();
      for (const o of result.overlaps) if (!o.whole && o.fraction !== null) fractions.set(o.zcta5, o.fraction);
      scopes.push({
        kind: "RESOLVED",
        decision,
        zctas: new Set(result.overlaps.map((o) => o.zcta5)),
        whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)),
        fractions,
        states,
      });
    } catch (error) {
      scopes.push({
        kind: "UNRESOLVED",
        decision,
        why: `the lookup refused this geography (${error instanceof Error ? error.message : String(error)})`,
        states: [g.stateAbbr],
      });
    }
  }
  return { scopes, lookup: lookupReading };
}

type LookupState = { readonly lookup: CensusGeographyLookup; readonly source: PublishedLookupSource; readonly versionId: string };

export interface ExpansionLoad {
  /** Held Census memberships plus acquired intersections for unheld ZIPs.
   * Work placement inputs, not invented registry bodies. */
  readonly nationalPlaces?: ReadonlyMap<string, readonly PlaceDivision[]>;
  /** Null when no scope is selected and nothing on the policy row is unreadable: the cycle runs exactly as before. */
  readonly plan: ExpansionPlan | null;
  /** Named runtime conditions for the research state. Empty when nothing went wrong. */
  readonly conditions: readonly string[];
  /** The territory index the plan was placed with. Null when no scope is selected, or with `territoryDetail` saying why. */
  readonly territory?: TerritoryIndex | null;
  readonly territoryDetail?: string | null;
}

/**
 * Everything the cycle needs to honor the owner's scopes, read once at the
 * top of the cycle. Every failure is a named condition and resolves toward
 * holding paid work back, never toward "no scope stands".
 */
export async function loadExpansionPlan(input: {
  readonly repos: ControlPlaneRepositories;
  readonly root: string;
  readonly now: string;
  readonly obligations: readonly ScopedStandingWork[];
  /** Injected in tests; the runner uses the published lookup. */
  readonly loadLookup?: () => Promise<LookupState>;
  /** Injected in tests; the runner reads the committed territories and the preloaded registries. */
  readonly loadTerritory?: (states: readonly string[], zips: ReadonlySet<string>, places: ReadonlyMap<string, readonly PlaceDivision[]>) => TerritoryIndex;
  readonly loadNationalZip?: (zip: string) => Promise<readonly PlaceDivision[]>;
  /**
   * Called once the scopes are resolved, with every state they span (a metro's member states included), before
   * the territory is read: the runner reads there the registration of each state with no reviewed registry
   * (`preloadRegistrationJurisdictions`). Answers named conditions, if any.
   */
  readonly beforeTerritory?: (states: readonly string[]) => Promise<readonly string[]>;
}): Promise<ExpansionLoad> {
  const conditions: string[] = [];
  let decisions: readonly ExpansionScopeDecision[] = [];
  let malformed = 0;
  try {
    const row = await input.repos.adminConfig.read(ADMIN_CONFIG_ID);
    if (row !== null && !isAdminConfig(row.value)) {
      /* A policy row that is not a policy fails closed: readable scopes are kept, and the row counts as one unreadable entry, holding paid Scout work. */
      const salvaged = row.value !== null && typeof row.value === "object" ? expansionScopesOf(row.value as { readonly expansionScopes?: unknown }) : null;
      decisions = salvaged?.scopes ?? [];
      malformed = 1 + (salvaged?.malformed ?? 0);
      conditions.push(
        "the owner's policy row is on record and is not a readable policy, so whether an expansion scope budget stands cannot be known; " +
          `paid Scout work is held this cycle${decisions.length > 0 ? ` (${decisions.length} scope(s) on it were still readable and are placed as usual)` : ""}`,
      );
    } else {
      const held = expansionScopesOf(row !== null ? row.value : null);
      decisions = held.scopes;
      malformed = held.malformed;
    }
  } catch (error) {
    malformed = 1;
    conditions.push(
      `the owner's expansion scopes could not be read (${error instanceof Error ? error.message : String(error)}); ` +
        "a scope budget may stand, so paid Scout work is held this cycle",
    );
  }
  if (decisions.length === 0 && malformed === 0) return { plan: null, conditions };
  if (malformed > 0 && conditions.length === 0) {
    conditions.push(`${malformed} entr${malformed === 1 ? "y" : "ies"} on the owner's expansion scope list could not be read; paid Scout work is held this cycle`);
  }

  let state: LookupState | null = null;
  let unreadable: string | null = null;
  if (decisions.length > 0) {
    try {
      state = await (input.loadLookup ?? (() => loadPublishedLookupState({ bypassCache: true })))();
    } catch (error) {
      unreadable = error instanceof Error ? error.message : String(error);
      conditions.push(`the published Census geography lookup could not be read (${unreadable}); ZIPs try the national Census source`);
    }
  }
  const resolved = await resolveScopes(decisions, state, unreadable);
  const nationalPlaces = new Map<string, readonly PlaceDivision[]>();
  const scopes = await Promise.all(resolved.scopes.map(async scope => {
    const geography = scope.decision.geography;
    if (scope.kind !== "UNRESOLVED" || geography.type !== "zcta" || geography.version !== "zcta:2020") return scope;
    try {
      const divisions = await (input.loadNationalZip ?? divisionsForZip)(geography.geoid);
      const states = [...new Set(divisions.flatMap(d => /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(d.id)?.[1].toUpperCase() ?? []))];
      if (!states.length || !divisions.some(d => d.divisionType === "county")) throw new Error("Census returned no county/state divisions for the ZIP");
      nationalPlaces.set(geography.geoid, divisions);
      return { kind: "RESOLVED" as const, decision: scope.decision, states,
        zctas: new Set([geography.geoid]), whole: new Set([geography.geoid]), fractions: new Map<string, number>() };
    } catch (error) {
      conditions.push(`National Census lookup for ${geography.geoid} failed: ${error instanceof Error ? error.message : String(error)}`);
      return scope;
    }
  }));
  if (state?.source === "published") {
    const heldState = state;
    const zips = [...new Set(scopes.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.zctas] : []))];
    await Promise.all(zips.filter(zip => !nationalPlaces.has(zip)).map(async zip => {
      try { nationalPlaces.set(zip, await heldDivisionsForZip(zip, heldState)); }
      catch (error) { conditions.push(`Held Census divisions for ${zip} could not be read: ${error instanceof Error ? error.message : String(error)}`); }
    }));
  }

  let territory: TerritoryIndex | null = null;
  let territoryDetail: string | null = null;
  if (decisions.length > 0 && input.beforeTerritory !== undefined) {
    const states = [...new Set(scopes.flatMap((s) => s.states.map((st) => st.toUpperCase())))].sort();
    try {
      conditions.push(...(await input.beforeTerritory(states)));
    } catch (error) {
      conditions.push(`the registration of ${states.join(", ")} could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (decisions.length > 0) {
    try {
      const states = [...new Set(scopes.flatMap(scope => scope.states))];
      const zips = new Set(scopes.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.zctas] : []));
      territory = (input.loadTerritory ?? (() => {
        const registries = Object.values(installedOperationalReferenceRegistries(states));
        if (registries.length === 0) throw new Error("OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED: no promoted jurisdiction registry was preloaded");
        return readTerritoryIndex(input.root, registries, states, zips, nationalPlaces);
      }))(states, zips, nationalPlaces);
    } catch (error) {
      territoryDetail = error instanceof Error ? error.message : String(error);
      conditions.push(`the expansion territory index could not be built (${territoryDetail}); no work is placed in a scope this cycle`);
    }
  }

  let declaredMembers: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  if (state?.source === "published") {
    try { declaredMembers = await declaredWorkMembers(resolved.scopes, input.obligations, state.lookup, territory?.byDivision); }
    catch (error) { malformed += 1; conditions.push(`Shared-work scope attribution failed; paid work is held: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return {
    nationalPlaces,
    plan: planExpansion({
      declaredMembers,
      now: input.now,
      scopes,
      malformedScopes: malformed,
      lookup: resolved.lookup,
      territory,
      territoryDetail,
      obligations: input.obligations,
    }),
    conditions,
    territory,
    territoryDetail,
  };
}
