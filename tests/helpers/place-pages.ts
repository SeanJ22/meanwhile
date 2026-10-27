import { buildPageBody } from "../../lib/reader/place-builder.ts";
import { packPlaceContext, packReadyPlace } from "../../lib/reader/place-ready.ts";
import type { Query } from "../../lib/facts/publish.ts";
import type { PlaceInput } from "../../lib/reader/place-types.ts";
import { preparePlaceRosters, savePlaceRosters } from "../../lib/reader/body-roster.ts";

/** Fixture publication runs the real page builder before installing the reader connection. */
export async function seedPlacePages(query: Query, input: PlaceInput): Promise<void> {
  const state = input.state.toUpperCase(), roots = new Set(input.divisionIds);
  for (const id of input.namedDivisionIds ?? []) roots.add(id);
  const bodies = new Set<string>();
  for (const requested of input.bodyIds ?? []) {
    const [alias] = await query("SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=$1", [requested]);
    bodies.add(String(alias?.entity_id ?? requested));
  }
  if (input.allBodies) for (const row of await query("SELECT id FROM entity WHERE kind='body' AND state=$1::char(2)", [state])) bodies.add(String(row.id));
  if (input.neighbors) for (const id of bodies) {
    if (id.startsWith("ocd-division/")) roots.add(id.split("#")[0]!);
    for (const row of await query("SELECT place_id FROM entity_place WHERE entity_id=$1", [id])) roots.add(String(row.place_id));
  }
  if (input.allBodies || !input.divisionIds.length && !bodies.size) roots.add(`ocd-division/country:us/state:${state.toLowerCase()}`);
  for (const id of roots) await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,$2) ON CONFLICT DO NOTHING", [id, state]);
  for (const id of bodies) await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$1,$2) ON CONFLICT DO NOTHING", [id, state]);
  for (const [id, kind] of [...[...bodies].map(id => [id, "body"]), ...[...roots].map(id => [id, "place"])] as const) {
    const { readyCurrent, readyHistory, territory, ...context } = await buildPageBody(id, kind, state, query);
    await savePlaceRosters(query,[readyCurrent,...readyHistory?[readyHistory]:[]]);
    await query(`INSERT INTO place_page(place_id,version,built_at,body,history_body,context) VALUES($1,1,clock_timestamp(),$2::jsonb,$3::jsonb,$4::jsonb)
      ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,built_at=excluded.built_at,body=excluded.body,
        history_body=excluded.history_body,context=excluded.context`, [id, JSON.stringify(packReadyPlace(readyCurrent,territory)), JSON.stringify(readyHistory ? packReadyPlace(readyHistory) : {}),
      JSON.stringify(id.startsWith("zip:") ? { formatVersion: context.formatVersion } : {
        ...packPlaceContext(context), rosterRefs: preparePlaceRosters(readyCurrent).place.rosterRefs })]);
  }
}
