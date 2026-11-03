import { buildSlices, MEETING_CARDS, SLICE_CARDS, writeSlices, type SliceCard } from "../../lib/reader/slices.ts";
import { buildPageBody } from "../../lib/reader/place-builder.ts";
import { packPlaceContext } from "../../lib/reader/place-ready.ts";
import type { Query } from "../../lib/facts/publish.ts";
import type { PlaceInput } from "../../lib/reader/place-types.ts";

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
  for (const [id, kind] of [...[...roots].map(id => [id, "place"]), ...[...bodies].map(id => [id, "body"])] as const) {
    await query(`INSERT INTO place_page(place_id,version,built_at,context) VALUES($1,1,clock_timestamp(),$2::jsonb)
      ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,built_at=excluded.built_at,context=excluded.context`,
    [id, JSON.stringify(packPlaceContext(await buildPageBody(id, kind, state, query) as unknown as Record<string, unknown>))]);
  }
}

/** The slices of the places and boards a selection names, built from the facts held, as the slice job writes them. */
export async function seedPlaceSlices(query: Query, input: PlaceInput): Promise<void> {
  const state = input.state.toUpperCase(), places = new Set([...input.divisionIds, ...input.namedDivisionIds ?? []]);
  const boards = new Set<string>();
  // The slice job builds the state's own division too: it holds what every page of the state shares.
  if (state !== "US") places.add(`ocd-division/country:us/state:${state.toLowerCase()}`);
  for (const requested of input.bodyIds ?? []) {
    const [alias] = await query("SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=$1", [requested]);
    boards.add(String(alias?.entity_id ?? requested));
  }
  if (input.neighbors) for (const id of boards) {
    if (id.startsWith("ocd-division/")) places.add(id.split("#")[0]!);
    for (const row of await query("SELECT place_id FROM entity_place WHERE entity_id=$1", [id])) places.add(String(row.place_id));
  }
  for (const id of places) await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,$2) ON CONFLICT DO NOTHING", [id, state]);
  // The slice job builds every place a board is filed on, whether or not a page names it.
  for (const row of await query("SELECT DISTINCT place_id FROM entity_place WHERE entity_id=ANY($1::text[])", [[...boards]])) places.add(String(row.place_id));
  for (const row of await query(`SELECT DISTINCT coalesce(x.entity_id,e.id) AS id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id AND e.kind='body'
    LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.id WHERE ep.place_id=ANY($1::text[])`, [[...places]])) boards.add(String(row.id));
  // A selection is read from slices only when every place and board it reaches has its last card, so the fixture builds them all.
  for (const row of await query("SELECT id,kind FROM entity WHERE kind IN ('place','body') AND NOT EXISTS (SELECT 1 FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=entity.id)")) (row.kind === "place" ? places : boards).add(String(row.id));
  const wanted = new Map<string, ReadonlySet<SliceCard>>([...[...places].map(id => [id, new Set<SliceCard>(SLICE_CARDS)] as const), ...[...boards].map(id => [id, new Set<SliceCard>(MEETING_CARDS)] as const)]);
  await writeSlices(query, await buildSlices(query, wanted));
}
