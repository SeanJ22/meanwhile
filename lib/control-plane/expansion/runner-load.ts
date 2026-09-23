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
 *                                 in `membership.ts`
 * ```
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
import {
  buildTerritoryIndex,
  planExpansion,
  type CensusUnitTerritory,
  type ExpansionPlan,
  type ResolvedScope,
  type TerritoryIndex,
} from "./membership.ts";
import type { ExpansionCycleReading } from "./reading.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "./scopes.ts";

/** Where the committed Census unit territories live, relative to the repository root. */
export const CENSUS_UNIT_TERRITORY_PATH = ["data", "derived", "census-unit-zips.json"] as const;

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
      scopes.push({ kind: "RESOLVED", decision, zctas: new Set(result.overlaps.map((o) => o.zcta5)), states });
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
}): Promise<ExpansionLoad> {
  const conditions: string[] = [];
  let decisions: readonly ExpansionScopeDecision[] = [];
  let malformed = 0;
  try {
    const row = await input.repos.adminConfig.read(ADMIN_CONFIG_ID);
    const held = expansionScopesOf(row !== null && isAdminConfig(row.value) ? row.value : null);
    decisions = held.scopes;
    malformed = held.malformed;
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
  if (decisions.length > 0) {
    try {
      territory = (input.loadTerritory ?? (() => buildTerritoryIndex(
        Object.values(requiredOperationalReferenceBundle().registries),
        readCensusUnitTerritories(input.root),
      )))();
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
  };
}
