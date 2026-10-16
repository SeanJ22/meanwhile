import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../../registry/runtime-data-plane.ts";
import { registrationTarget } from "../../registration/publication.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import type { GeographyRef } from "../../census-geography/contract.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { readCensusGeographyIndex, type ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";
import { censusDistrictEdgeSlice, readCensusDistrictState } from "../../census-geography/district-edge.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../../meetings/edge-store.ts";
import type { AcsJoinTarget } from "./national.ts";
import type { AcsScope, AcsPopulationRow } from "./index.ts";
import { loadRegistrationReference } from "../../registration/reference.ts";
import { readPlacePayloadParts } from "../../civic-data/place-payload-slices.ts";

const TYPES: Readonly<Record<string, AcsScope>> = { county: "county", place: "place", county_subdivision: "county_subdivision",
  cousub: "county_subdivision", cd: "congressional_district", sldu: "state_leg_upper", sldl: "state_leg_lower",
  congressional_district: "congressional_district", state_leg_upper: "state_leg_upper", state_leg_lower: "state_leg_lower",
  unsd: "school_unified", elsd: "school_elementary", scsd: "school_secondary" };

/** Read only the state's official geography keys from held pointers. Missing bindings leave ACS rows unjoined. */
export async function heldAcsJoinTargets(stateFips: string, rows: readonly AcsPopulationRow[] = [], query: ReadOnlyQuery | null = readerQuery(),
  artifactStore: ReaderArtifactReadStore | null = resolveReaderArtifactStore()): Promise<AcsJoinTarget[]> {
  if (!query) throw new Error("The held Census joins have no reader database connection.");
  const state = FIPS_TO_STATE[stateFips]?.postal;
  if (!state) throw new Error("The ACS state has no held FIPS identity.");
  const [divisions] = await query([
    { text: "SELECT d AS division FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'divisions') d" +
      " WHERE ((p.record_class = 'REGISTRATION' AND p.scope = $1) OR (p.record_class = 'REGISTRY_RUNTIME_BINDING' AND p.scope = $2))" +
      " AND upper(d->>'state') = $3", params: [registrationTarget(state).scope, REGISTRY_RUNTIME_SCOPE, state] },
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
    const registry = await readPlacePayloadParts(query, "REGISTRY_RUNTIME_BINDING", [REGISTRY_RUNTIME_SCOPE], requested, [], []);
    const held = registry.get(REGISTRY_RUNTIME_SCOPE) as { registry?: { divisions?: readonly { divisionType: string; geoid: string; ocdId: string }[] } };
    for (const division of held.registry?.divisions ?? []) {
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
  const index = await readCensusGeographyIndex(query, state);
  if (index.kind === "UNREAD") throw new Error("The held Census state index could not be read.");
  if (index.kind === "HELD") {
    if (!artifactStore) throw new Error("The held Census state artifact store is unavailable.");
    const artifact = await readCensusDistrictState(index.value, state, artifactStore);
    if (!artifact) throw new Error("The held Census state artifact is unavailable or invalid.");
    for (const { ref } of artifact.containers) {
      if (ref.stateFips !== stateFips) continue;
      const geography = TYPES[ref.type], divisionId = censusWorkDivision(ref);
      if (geography && divisionId) targets.push({ geography, geoid: ref.geoid, divisionId });
    }
    for (const zip of Object.keys(artifact.codes)) {
      if (!/^\d{5}$/.test(zip)) throw new Error("The held Census state ZIP is invalid.");
      const slice = censusDistrictEdgeSlice(artifact, index.value.versionId, zip);
      if (slice.kind !== "HELD") throw new Error("The held Census state ZIP membership is invalid.");
      if (slice.value.containers.some(row => row.ref.stateFips === stateFips)) {
        targets.push({ geography: "zcta", geoid: zip, divisionId: `zcta:${zip}` });
      }
    }
  }
  return targets;
}
