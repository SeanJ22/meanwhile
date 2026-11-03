import { readPromotedCivicData, CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { Query } from "../facts/publish.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { publicationVersion, readCanonicalShelf } from "./canonical.ts";

type Row = Record<string, unknown>;
/** A row of the state's registry with its place in the state's list, which is the order readers see. */
type At<T = Row> = readonly [number, T];

/**
 * What the state's reviewed registry holds for one place, as its bodies card keeps it: the registry's rows for the boards filed there, their rosters,
 * the divisions the place sits in below the state, and the candidacies, photos and dispositions of the people its boards seat or of those whose seats lie in
 * those divisions. The state's own card also holds the statewide rows and the model without its rows (`k`); `sel` is what only a page that names the state holds.
 */
export interface PlaceRuntime {
  readonly k?: RegistryRuntimeReadModel;
  readonly b?: readonly At[];
  readonly r?: readonly At[];
  readonly d?: readonly At[];
  readonly c?: readonly At[];
  readonly p?: readonly At[];
  readonly x?: readonly At[];
  readonly e?: readonly At[];
  readonly f?: readonly At<readonly [string, string]>[];
  readonly sel?: Omit<PlaceRuntime, "k" | "sel">;
}
type Lists = Omit<PlaceRuntime, "k" | "sel">;
const LIST_KEYS = ["b", "r", "d", "c", "p", "x", "e", "f"] as const;

export const STATE_LEVEL = /^ocd-division\/country:us\/(?:state|district|territory):[^/]+$/;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
/** A stored JSON object lists its keys shortest first, then in byte order; a body made over here must list them the same. */
const stored = (row: Row): Row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)));

const keyOf = (state: string) => `REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state)}`;
const models = new Map<string, { readonly version: string; readonly model: RegistryRuntimeReadModel | null }>();
/** A state's reviewed registry, for the slice job only: held in the builder's memory by the content version of its pointer, and read again when that moves. No reader opens it. */
export async function stateRegistry(query: Query, state: string): Promise<RegistryRuntimeReadModel | null> {
  const store: ReadOnlyQuery = statements => Promise.all(statements.map(async statement => [...await query(statement.text, [...statement.params])]));
  const version = await publicationVersion([keyOf(state)], store), held = models.get(state);
  if (held?.version === version) return held.model;
  const entry = { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state) };
  const read = await readCanonicalShelf([entry], store).then(shelf => readPromotedCivicData<RegistryRuntimeReadModel>(entry.recordClass, entry.scope, { store: shelf }));
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  const model = read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value : null;
  models.set(state, { version, model });
  return model;
}

/** A board the card holds, as the fact store knows it: the names it was folded from, every place it is filed on, and its name. */
export interface BoardKnown { readonly aliases: readonly string[]; readonly filed: readonly string[]; readonly name: string }

/**
 * The lists for a place selecting `selected` (and, from `seed`, the divisions a page would reach above it), for the boards of its card. A body a board was
 * folded into is named by the board it was folded into, and a board filed on a local place no longer names the state as its division.
 */
export function placeRuntime(model: RegistryRuntimeReadModel, input: { readonly selected: readonly string[]; readonly seed?: readonly string[]; readonly boards: ReadonlyMap<string, BoardKnown>;
  readonly peopleIds: readonly string[]; readonly stateLevel: boolean }): Lists {
  const selected = new Set(input.selected), canon = new Map([...input.boards].flatMap(([board, known]) => [[board, board] as const, ...known.aliases.map(alias => [alias, board] as const)]));
  const chosen = new Map<string, { readonly body: Row; readonly alias: boolean; readonly at: number }>();
  rows(model.registry.bodies).forEach((original, at) => {
    const id = String(original.id), board = canon.get(id), known = board === undefined ? undefined : input.boards.get(board);
    if (board === undefined || !known) return;
    const ocd = text(original.ocdId), local = known.filed.some(place => !STATE_LEVEL.test(place)), also = original.alsoServesOcdIds as string[] | undefined;
    const body = stored({ ...original, ...(board === id ? {} : { id: board, name: known.name || original.name }),
      ocdId: ocd !== null && local && STATE_LEVEL.test(ocd) ? null : ocd, ...(known.filed.length ? { alsoServesOcdIds: [...new Set([...known.filed, ...also ?? []])] } : {}) });
    if (!chosen.has(board) || chosen.get(board)!.alias && board === id) chosen.set(board, { body, alias: board !== id, at });
  });
  const allBoards = new Set(input.boards.keys()), divisions = new Set([...selected, ...input.seed ?? [], ...[...chosen.values()].flatMap(row => text(row.body.ocdId) ?? [])]);
  for (const division of divisions) { const parent = text(rows(model.registry.divisions).find(row => row.ocdId === division)?.parentOcdId); if (parent) divisions.add(parent); }
  if (!input.stateLevel) for (const division of divisions) if (STATE_LEVEL.test(division)) divisions.delete(division);
  const at = <T>(list: readonly T[], keep: (row: T) => boolean): At<T>[] => list.flatMap((row, index) => keep(row) ? [[index, row] as const] : []);
  const rosters = at(model.bodyRosters, roster => allBoards.has(canon.get(roster.bodyId) ?? roster.bodyId)).map(([index, roster]) => [index, canon.get(roster.bodyId) === roster.bodyId ? roster : { ...roster, bodyId: canon.get(roster.bodyId)! }] as const);
  const executives = at(model.statewideExecutives, executive => selected.has(String(executive.stateOcdId)));
  const people = new Set([...input.peopleIds, ...rosters.flatMap(([, roster]) => roster.members.flatMap(member => [member.id, member.personId, member.sourceRecordId,
    ...Object.values(member.nativeIds ?? {}).flat()])), ...executives.map(([, executive]) => executive.holder.id)].filter((id): id is string => !!id));
  const candidacies = at(model.officialCandidacies.rows, row => people.has(row.holder.id) || row.holder.divisions.some(id => divisions.has(id)));
  const holders = new Set([...people, ...candidacies.map(([, row]) => row.holder.id)]);
  const photos = at(model.officialPhotos.photos, photo => holders.has(photo.officeholderId) || (photo.personId !== undefined && people.has(photo.personId)));
  const photoOwners = new Set([...people, ...photos.map(([, photo]) => photo.officeholderId)]);
  return { b: [...chosen.values()].map(row => [row.at, row.body] as const).sort((a, b) => a[0] - b[0]), r: rosters as unknown as At[], d: at(model.registry.divisions, division => divisions.has(division.ocdId)) as unknown as At[],
    c: candidacies as unknown as At[], p: photos as unknown as At[], e: executives as unknown as At[],
    x: at(model.rosterReaderDispositions, row => people.has(row.sourceId) || row.canonicalId !== null && people.has(row.canonicalId) || [...allBoards].some(board => row.sourceId.startsWith(`roster:${board}#`))) as unknown as At[],
    f: Object.entries(model.rosterPhotos).flatMap(([id, url], index) => photoOwners.has(id) ? [[index, [id, url] as const] as const] : []) };
}
const trimmed = (lists: Lists): Lists => Object.fromEntries(LIST_KEYS.flatMap(key => lists[key]?.length ? [[key, lists[key]]] : []));

/**
 * The runtime registry of each place's card, from the places' boards in the fact store. A place sees the divisions above it up to the state and the
 * candidacies of the people its boards seat; the state's own card holds the statewide rows, the model without its rows, and in `sel` what a page that names the state also holds.
 */
export async function runtimeOf(query: Query, state: string, places: readonly string[]): Promise<Map<string, PlaceRuntime>> {
  const out = new Map<string, PlaceRuntime>();
  const model = await stateRegistry(query, state);
  if (!model) return out;
  const k: RegistryRuntimeReadModel = { ...model, registry: { ...model.registry, bodies: [], divisions: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [],
    officialCandidacies: { ...model.officialCandidacies, rows: [] }, officialPhotos: { ...model.officialPhotos, photos: [] }, rosterPhotos: {} };
  const filed = await query("SELECT DISTINCT ep.place_id,e.id,e.name FROM entity_place ep JOIN entity e ON e.id=ep.entity_id AND e.kind='body' WHERE ep.place_id=ANY($1::text[]) ORDER BY 1,2", [places]);
  const boardIds = [...new Set(filed.map(row => String(row.id)))];
  const [aliases, placesOf, members] = boardIds.length ? await Promise.all([
    query("SELECT entity_id,value FROM entity_external_id WHERE scheme='body-alias' AND entity_id=ANY($1::text[]) ORDER BY 1,2", [boardIds]),
    query("SELECT entity_id,place_id FROM entity_place WHERE entity_id=ANY($1::text[]) ORDER BY 1,2", [boardIds]),
    query("SELECT f.entity_id,substr(f.field,8) AS person,(SELECT array_agg(x.value ORDER BY x.value) FROM entity_external_id x WHERE x.entity_id=substr(f.field,8) AND x.scheme='roster-member') AS shown FROM checked_fact f WHERE f.status='live' AND f.field LIKE 'member:%' AND f.entity_id=ANY($1::text[])", [boardIds]),
  ]) : [[], [], []];
  const by = (list: readonly Row[], key: string) => { const map = new Map<string, Row[]>(); for (const row of list) map.set(String(row[key]), [...map.get(String(row[key])) ?? [], row]); return map; };
  const aliasOf = by(aliases, "entity_id"), placeOf = by(placesOf, "entity_id"), memberOf = by(members, "entity_id");
  for (const place of places) {
    const mine = filed.filter(row => row.place_id === place);
    const boards = new Map(mine.map(row => [String(row.id), { aliases: (aliasOf.get(String(row.id)) ?? []).map(alias => String(alias.value)), filed: (placeOf.get(String(row.id)) ?? []).map(at => String(at.place_id)), name: String(row.name) }]));
    const peopleIds = mine.flatMap(row => (memberOf.get(String(row.id)) ?? []).flatMap(member => [String(member.person), ...member.shown as string[] ?? []]));
    const stateLevel = STATE_LEVEL.test(place), base = { boards, peopleIds, stateLevel };
    if (!stateLevel) { const lists = trimmed(placeRuntime(model, { ...base, selected: [place] })); if (Object.keys(lists).length) out.set(place, { k, ...lists }); continue; }
    // The state's card: what any page reaches above its places, and apart from it what only a page naming the state holds.
    const above = placeRuntime(model, { ...base, selected: [], seed: [place] }), full = placeRuntime(model, { ...base, selected: [place] });
    const extra = Object.fromEntries(LIST_KEYS.flatMap(key => { const seen = new Set((above[key] ?? []).map(row => row[0])); const added = (full[key] ?? []).filter(row => !seen.has(row[0])); return added.length ? [[key, added]] : []; }));
    out.set(place, { k, ...trimmed(above), ...Object.keys(extra).length ? { sel: extra } : {} });
  }
  return out;
}

/** What a page holds of a state whose cards are not built yet: a registry with nothing in it, as a card not yet built is a card with nothing on it. */
const NO_REGISTRY: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: "1970-01-01T00:00:00.000Z", bodies: [], divisions: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [],
  officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} };

/** The cards' runtimes together: each list is the rows its cards hold once, in the state's order. `named` says whether the page names the state, which adds what only such a page holds. */
export function mergeRuntime(cards: readonly PlaceRuntime[], named: boolean): { readonly model: RegistryRuntimeReadModel; readonly bodies: ReadonlyMap<string, Row>; readonly rosters: ReadonlyMap<string, Row> } {
  const skeleton = cards.find(card => card.k)?.k;
  if (!skeleton) return { model: NO_REGISTRY, bodies: new Map(), rosters: new Map() };
  const once = <T>(key: (typeof LIST_KEYS)[number]): T[] => {
    const seen = new Map<number, unknown>();
    for (const card of cards) for (const list of named ? [card, card.sel] : [card]) for (const [at, row] of list?.[key] ?? []) seen.set(at, row);
    return [...seen].sort((a, b) => a[0] - b[0]).map(row => row[1] as T);
  };
  const bodies = once<Row>("b"), rosters = once<Row>("r");
  return { bodies: new Map(bodies.map(body => [String(body.id), body])), rosters: new Map(rosters.map(roster => [String(roster.bodyId), roster])), model: { ...skeleton,
    registry: { ...skeleton.registry, divisions: once("d") }, rosterReaderDispositions: once("x"), statewideExecutives: once("e"), officialCandidacies: { ...skeleton.officialCandidacies, rows: once("c") },
    officialPhotos: { ...skeleton.officialPhotos, photos: once("p") }, rosterPhotos: Object.fromEntries(once<readonly [string, string]>("f")) } };
}
