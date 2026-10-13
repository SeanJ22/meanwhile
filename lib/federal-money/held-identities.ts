import { readRegistrationProjection } from "../registration/reader.ts";
import { stateContainers, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { FederalMoneyJoinInput } from "./join.ts";
import { federalMoneyScope, type FederalMoneyProjection } from "./model.ts";

/** Read one state's promoted reference, then cut the reviewed registry in SQL.
 * This acquisition worker never downloads the country's registry. */
export async function readFederalMoneyJoinInput(state: string, store: RoutineDataStore, query: ReadOnlyQuery | null): Promise<FederalMoneyJoinInput> {
  const registration = await readRegistrationProjection(state, { store });
  const value = registration.kind === "PROMOTED" ? registration.value : null;
  const divisions: FederalMoneyJoinInput["divisions"][number][] = [...(value?.divisions ?? [])];
  const bodies: FederalMoneyJoinInput["bodies"][number][] = [...(value?.bodies ?? [])];
  if (query) {
    const result = await query([{
      text: "SELECT p.payload->'registry'->'divisions' IS NOT NULL AS held," +
        " (SELECT COALESCE(jsonb_agg(d), '[]'::jsonb) FROM jsonb_array_elements(p.payload->'registry'->'divisions') d WHERE upper(d->>'state') = $1) AS divisions," +
        " (SELECT COALESCE(jsonb_agg(b), '[]'::jsonb) FROM jsonb_array_elements(p.payload->'registry'->'bodies') b WHERE b->>'ocdId' ~ $2) AS bodies" +
        " FROM civic_data_promotions p WHERE record_class = 'REGISTRY_RUNTIME_BINDING' AND scope = 'US:reader-registry-runtime-bindings'",
      params: [state.toUpperCase(), `/(state|district|territory):${state.toLowerCase()}(/|$)`],
    }]);
    const row = result[0]?.[0];
    if (Array.isArray(row?.divisions)) divisions.push(...row.divisions as typeof divisions);
    if (Array.isArray(row?.bodies)) bodies.push(...row.bodies as typeof bodies);
    const geography = await stateContainers(state, ["county", "congressional_district"], false, query);
    if (geography.kind === "HELD") for (const { ref } of geography.value.containers) {
      const ocdId = censusWorkDivision(ref);
      if (ocdId) divisions.push({ ocdId, geoid: ref.geoid, divisionType: ref.type });
    }
  }
  const entities = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", federalMoneyScope("sam-gov-entities", state));
  return { divisions, bodies, governments: value?.governments ?? [], entities: entities?.payload.records ?? [] };
}
