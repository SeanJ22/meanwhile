import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { readRegistryRuntimeProjection } from "../../registry/runtime-read-model.ts";
import { registrationTarget } from "../../registration/publication.ts";
import { CENSUS_GEO_SCOPE, CENSUS_GEO_RECORD_CLASS } from "../../census-geography/publication.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import type { GeographyRef } from "../../census-geography/contract.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";
import type { AcsJoinTarget } from "./national.ts";
import type { AcsScope, AcsPopulationRow } from "./index.ts";
import { loadRegistrationReference } from "../../registration/reference.ts";

const TYPES: Readonly<Record<string, AcsScope>> = { county: "county", place: "place", county_subdivision: "county_subdivision",
  cousub: "county_subdivision", cd: "congressional_district", sldu: "state_leg_upper", sldl: "state_leg_lower",
  congressional_district: "congressional_district", state_leg_upper: "state_leg_upper", state_leg_lower: "state_leg_lower",
  unsd: "school_unified", elsd: "school_elementary", scsd: "school_secondary" };

/** Read only the state's official geography keys from held pointers. Missing bindings leave ACS rows unjoined. */
export async function heldAcsJoinTargets(stateFips: string, rows: readonly AcsPopulationRow[] = [], query: ReadOnlyQuery | null = readerQuery()): Promise<AcsJoinTarget[]> {
  if (!query) throw new Error("The held Census joins have no reader database connection.");
  const state = FIPS_TO_STATE[stateFips]?.postal;
  if (!state) throw new Error("The ACS state has no held FIPS identity.");
  const [divisions, containers] = await query([
    { text: "SELECT d AS division FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'divisions') d" +
      " WHERE p.record_class = 'REGISTRATION' AND p.scope = $1" +
      " AND upper(d->>'state') = $2", params: [registrationTarget(state).scope, state] },
    { text: "SELECT s->>'type' AS type, s->>'version' AS version, g AS geography FROM civic_data_promotions p" +
      " CROSS JOIN LATERAL jsonb_array_elements(p.payload->'scopes') s CROSS JOIN LATERAL jsonb_array_elements(s->'groupings') g" +
      " WHERE p.record_class = $1 AND p.scope = $2 AND g->>'stateFips' = $3", params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, stateFips] },
  ]);
  const targets: AcsJoinTarget[] = loadRegistrationReference(process.cwd(), state).reference.divisions.flatMap(([divisionId, layer, geoid]) => {
    const geography = TYPES[layer];
    return geography ? [{ geography, geoid, divisionId }] : [];
  });
  const requested = rows.filter(row => ["congressional_district", "state_leg_upper", "state_leg_lower"].includes(row.geography ?? "")).flatMap(row => {
    const divisionId = censusWorkDivision({ type: row.geography as GeographyRef["type"], geoid: row.code, label: row.name,
      version: `ACS:${row.attribution?.vintage}`, stateFips, stateAbbr: state, memberStates: [state], ocdId: null });
    return divisionId ? [divisionId] : [];
  });
  if (requested.length) {
    const registry = await readRegistryRuntimeProjection([state]);
    if (registry.kind !== "PROMOTED" && registry.kind !== "NOT_RECORDED") throw new Error(`ACS_REGISTRY_UNAVAILABLE:${state}:${registry.kind}`);
    const selected = new Set(requested);
    for (const division of registry.kind === "PROMOTED" ? registry.value.registry.divisions : []) {
      if (!selected.has(division.ocdId)) continue;
      const geography = TYPES[division.divisionType];
      if (geography && division.geoid) targets.push({ geography, geoid: division.geoid, divisionId: division.ocdId });
    }
  }
  for (const row of divisions) {
    const d = row.division as { divisionType?: string; geoid?: string; ocdId?: string; sourceDataset?: string };
    // A generic school-district label cannot tell unified, elementary or secondary.
    const type = TYPES[d.divisionType ?? ""] ?? (d.divisionType === "school_district" ? TYPES[String(d.sourceDataset).split(/[:/-]/).at(-1) ?? ""] : undefined);
    if (type && d.geoid && d.ocdId) targets.push({ geography: type, geoid: d.geoid, divisionId: d.ocdId });
  }
  for (const row of containers) {
    const g = row.geography as GeographyRef & { overlaps?: readonly { zcta5: string }[] };
    const geography = TYPES[String(row.type)];
    const divisionId = censusWorkDivision({ ...g, type: String(row.type) as GeographyRef["type"], version: String(row.version) });
    if (geography && divisionId) targets.push({ geography, geoid: g.geoid, divisionId });
    for (const zip of g.overlaps ?? []) targets.push({ geography: "zcta", geoid: zip.zcta5, divisionId: `zcta:${zip.zcta5}` });
  }
  return targets;
}
