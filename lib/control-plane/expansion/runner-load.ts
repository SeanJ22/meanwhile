/**
 * **THE RUNNER'S READS FOR THE EXPANSION SCOPES.** (Expansion controls, 2026-09-23.)
 *
 * Two reads, both only when the owner has selected at least one scope:
 *
 * ```
 *   the Census geography lookup   the published promoted pointer, through
 *                                 `loadPublishedLookupState` — ONE load per cycle,
 *                                 reused for every scope. Anything but a
 *                                 "published" source resolves nothing: a
 *                                 bootstrap fixture is not live coverage
 *   the Census unit territories   data/derived/census-unit-zips.json — the
 *                                 committed ZCTA territory of every Census of
 *                                 Governments unit, joined to the registries
 *                                 in `membership.ts` — with each unit's share
 *                                 of each ZCTA from the sampled overlap it was
 *                                 built from (data/derived/zip-governments.json)
 * ```
 *
 * The same reads serve the work a scope materializes (MW-028,
 * `dispatch-work.ts`): the territory index is returned with the plan, so it is
 * read once per cycle, never twice.
 *
 * SERVER-ONLY (node:fs and the production data plane). Never imported by a
 * client module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CensusGeographyLookup, GeographyType } from "../../census-geography/contract.ts";
import { loadPublishedLookupState, type PublishedLookupSource } from "../../census-geography/reader.ts";
import { requiredOperationalReferenceBundle } from "../../civic-data/operational-references.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { APPROXIMATE_DISTRICT_EXTRACT_PATH, type ApproximateDistrictExtract } from "./district-territory.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";
import {
  buildTerritoryIndex,
  planExpansion,
  unitShareKey,
  type CensusUnitTerritory,
  type ExpansionPlan,
  type ResolvedScope,
  type TerritoryIndex,
} from "./membership.ts";
import type { ExpansionCycleReading } from "./reading.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "./scopes.ts";

/** Where the committed Census unit territories live, relative to the repository root. */
export const CENSUS_UNIT_TERRITORY_PATH = ["data", "derived", "census-unit-zips.json"] as const;
/** The sampled ZCTA-to-government overlap those territories were built from. */
export const ZCTA_GOVERNMENT_SAMPLES_PATH = ["data", "derived", "zip-governments.json"] as const;

/**
 * Each wanted government's share of each of its ZCTAs, from the sampled
 * overlap: the government's lattice samples in the ZCTA over the ZCTA's
 * samples across the county layer (counties tile the land, so that is every
 * sample in the ZCTA). Only the keys asked for are kept.
 */
export function readZctaShares(root: string, wanted: ReadonlySet<string>): Map<string, Map<string, number>> {
  const path = join(root, ...ZCTA_GOVERNMENT_SAMPLES_PATH);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    readonly zips?: Readonly<Record<string, readonly { readonly layer: string; readonly id: string; readonly samples: number }[]>>;
  };
  if (parsed.zips === undefined || Object.keys(parsed.zips).length === 0) {
    throw new Error(`${ZCTA_GOVERNMENT_SAMPLES_PATH.join("/")} carries no ZCTAs — a failed read, never a country with no overlap`);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [zcta, edges] of Object.entries(parsed.zips)) {
    const total = edges.filter((e) => e.layer === "county").reduce((n, e) => n + e.samples, 0);
    if (total <= 0) continue;
    for (const edge of edges) {
      const key = `${edge.layer}:${edge.id}`;
      if (!wanted.has(key)) continue;
      const shares = out.get(key) ?? new Map<string, number>();
      shares.set(zcta, Math.min(1, edge.samples / total));
      out.set(key, shares);
    }
  }
  return out;
}

/**
 * The territory index the runner uses: the preloaded registries, the committed
 * units, and their sampled shares — for every unit, registered state or not
 * (MW-028, 2026-09-23), so a geography in a state with no registry counts the
 * governments it blocks by the same certain-overlap rule as a registered one,
 * rather than by wholly-inside ZCTAs alone.
 */
export function readTerritoryIndex(root: string, registries: readonly JurisdictionRegistry[]): TerritoryIndex {
  const units = readCensusUnitTerritories(root);
  const wanted = new Set<string>();
  for (const unit of units) {
    const key = unitShareKey(unit);
    if (key !== null) wanted.add(key);
  }
  /* A registry read from registration places each government by the division its body sits on, by that division's own layer and GEOID (2026-09-25). */
  for (const registry of registries) {
    if (registry.registration?.kind !== "REGISTRATION") continue;
    for (const j of registry.jurisdictions) if (j.censusDivision) wanted.add(j.censusDivision);
  }
  const shares = readZctaShares(root, wanted);
  return buildTerritoryIndex(registries, units, (key) => shares.get(key), (j) => {
    const own = j.censusDivision ? shares.get(j.censusDivision) : undefined;
    return own === undefined ? undefined : { zctas: new Set(own.keys()), shares: own };
  }, readApproximateDistrictExtract(root));
}

/**
 * The approximate special-district boundary extract (`district-territory.ts`): read here, for Send placement only,
 * and nowhere on a reader path (tests/district-territory.test.ts holds that). A missing or malformed file is named.
 */
export function readApproximateDistrictExtract(root: string): ApproximateDistrictExtract {
  const path = join(root, ...APPROXIMATE_DISTRICT_EXTRACT_PATH);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ApproximateDistrictExtract;
  if (parsed.kind !== "az-fire-district-territory" || parsed.formatVersion !== 1 || !Array.isArray(parsed.districts) || !/APPROXIMATE/.test(parsed.provenance?.approximate ?? "")) {
    throw new Error(`${APPROXIMATE_DISTRICT_EXTRACT_PATH.join("/")} is not an approximate district extract this build reads`);
  }
  return parsed;
}

/** Read the Census unit territories. Throws with the path named; the caller turns that into a named condition. */
export function readCensusUnitTerritories(root: string): readonly CensusUnitTerritory[] {
  const path = join(root, ...CENSUS_UNIT_TERRITORY_PATH);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { readonly units?: unknown };
  if (!Array.isArray(parsed.units) || parsed.units.length === 0) {
    throw new Error(`${CENSUS_UNIT_TERRITORY_PATH.join("/")} carries no units — a failed read, never a country with no governments`);
  }
  return parsed.units as readonly CensusUnitTerritory[];
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
  /** Null when no scope is selected and nothing on the policy row is unreadable: the cycle runs exactly as before. */
  readonly plan: ExpansionPlan | null;
  /** Named runtime conditions for the research state. Empty when nothing went wrong. */
  readonly conditions: readonly string[];
  /**
   * The territory index the plan was placed with, for the work a scope
   * materializes (MW-028, `dispatch-work.ts`) — read once, never twice. Null
   * when no scope is selected, or with `territoryDetail` saying why it could
   * not be built.
   */
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
  readonly obligations: readonly { readonly id: string; readonly subjectId: string }[];
  /** Injected in tests; the runner uses the published lookup. */
  readonly loadLookup?: () => Promise<LookupState>;
  /** Injected in tests; the runner reads the committed territories and the preloaded registries. */
  readonly loadTerritory?: () => TerritoryIndex;
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
      /*
       * A policy row that is not a policy fails CLOSED, exactly as a row that
       * could not be read does (2026-09-25). It used to read as "no row", so the
       * owner's scope budgets silently disappeared and paid work ran unbounded
       * by them. Whatever scopes the row still carries readably are kept, so
       * their work is still placed and created; the row itself counts as one
       * unreadable entry, which holds paid Scout work until it is fixed.
       */
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
      conditions.push(`the Census geography lookup could not be read (${unreadable}); no expansion scope is resolved this cycle`);
    }
  }
  const resolved = await resolveScopes(decisions, state, unreadable);

  let territory: TerritoryIndex | null = null;
  let territoryDetail: string | null = null;
  if (decisions.length > 0 && input.beforeTerritory !== undefined) {
    const states = [...new Set(resolved.scopes.flatMap((s) => s.states.map((st) => st.toUpperCase())))].sort();
    try {
      conditions.push(...(await input.beforeTerritory(states)));
    } catch (error) {
      conditions.push(`the registration of ${states.join(", ")} could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (decisions.length > 0) {
    try {
      territory = (input.loadTerritory ?? (() => readTerritoryIndex(input.root, Object.values(requiredOperationalReferenceBundle().registries))))();
    } catch (error) {
      territoryDetail = error instanceof Error ? error.message : String(error);
      conditions.push(`the expansion territory index could not be built (${territoryDetail}); no work is placed in a scope this cycle`);
    }
  }

  return {
    plan: planExpansion({
      now: input.now,
      scopes: resolved.scopes,
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
