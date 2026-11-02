import { readPromotedCivicData, CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { readerDatabaseQuery } from "./database.ts";
import { MEETING_PARTITIONS_SQL, publicationVersion, readCanonicalShelf } from "./canonical.ts";
import { shelfPart } from "./shelf.ts";

/** A state's reviewed registry, and whether the state's registration of governments is held. */
export interface StateRegistry {
  readonly model: RegistryRuntimeReadModel | null;
  readonly registrationHeld: boolean;
}

const keyOf = (state: string) => ({ runtime: `REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state)}`, registration: `REGISTRATION:US-${state}:registration:v1` });

async function loadRegistry(state: string): Promise<StateRegistry> {
  const entry = { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state) };
  const query = readerDatabaseQuery();
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  const [read, [[held]]] = await Promise.all([
    readCanonicalShelf([entry]).then(store => readPromotedCivicData<RegistryRuntimeReadModel>(entry.recordClass, entry.scope, { store })),
    query([{ text: "SELECT EXISTS(SELECT 1 FROM civic_data_promotions WHERE key=$1 AND record_class='REGISTRATION') AS held", params: [keyOf(state).registration] }]),
  ]);
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  return { model: read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value : null, registrationHeld: held?.held === true };
}

const registries = new Map<string, ReturnType<typeof shelfPart<StateRegistry>>>();

/**
 * One state's reviewed registry (its boards with the divisions each serves, division parents, body rosters and their members, statewide
 * executives, candidacies, official and roster photos), the same for every place in the state: held in this server's memory, checked by
 * its published version, and read again only when that moves.
 */
export function stateRegistry(state: string): Promise<StateRegistry> {
  let part = registries.get(state);
  if (!part) registries.set(state, part = shelfPart(`registry:${state}`, () => publicationVersion(Object.values(keyOf(state))), () => loadRegistry(state)));
  return part.read();
}

/** A state's own family calendar (or its held history), without its rows: the sources it reports and the boards it follows. Every place in the state carries it. */
export interface StateFamily { readonly scope: string; readonly version: string; readonly confirmation: string | null; readonly header: Record<string, unknown>; readonly members: readonly Record<string, unknown>[] | null }
const families = new Map<string, ReturnType<typeof shelfPart<StateFamily | null>>>();
export function stateFamily(state: string, history = false): Promise<StateFamily | null> {
  const name = `family:${state}${history ? ":history" : ""}`;
  let part = families.get(name);
  if (!part) {
    const key = `MEETING:source:derived:family:US-${state}${history ? ":history" : ""}`;
    families.set(name, part = shelfPart(name, () => publicationVersion([key]), async () => {
      const query = readerDatabaseQuery();
      if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
      const [[row]] = await query([{ text: MEETING_PARTITIONS_SQL, params: [[key], []] }]);
      return row ? { scope: String(row.scope), version: String(row.version), confirmation: (row.confirmation as string | null) ?? null, header: row.header as Record<string, unknown>, members: row.members as StateFamily["members"] } : null;
    }));
  }
  return part.read();
}

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
const STATE_LEVEL = /^ocd-division\/country:us\/(?:state|district|territory):[^/]+$/;
/** A stored JSON object lists its keys shortest first, then in byte order; a body made over here must list them the same. */
const stored = (row: Row): Row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)));

/**
 * What the state's registry holds for one place, as its saved page held it: the boards that serve its divisions or are among `boardIds`
 * (a board folded into another is named by the one it was folded into, and a board filed on a local place no longer names the state as its
 * division), the divisions of those and their parents, those boards' rosters, the statewide executives of its state, and the
 * candidacies, photos and dispositions of the people it names. `filed` is where each board is filed; `peopleIds` adds the people its held rosters seat.
 */
export function placeRegistry(model: RegistryRuntimeReadModel, input: { readonly divisionIds: readonly string[]; readonly boardIds: readonly string[]; readonly peopleIds?: readonly string[];
  readonly aliasOf: ReadonlyMap<string, string>; readonly filed: ReadonlyMap<string, readonly string[]>; readonly names: ReadonlyMap<string, string> }): RegistryRuntimeReadModel {
  const selected = new Set(input.divisionIds), held = new Set(input.boardIds), canon = (id: string) => input.aliasOf.get(id) ?? id;
  const chosen = new Map<string, { readonly body: Row; readonly alias: boolean; readonly at: number }>();
  rows(model.registry.bodies).forEach((original, at) => {
    const id = String(original.id), board = canon(id), filed = input.filed.get(board), ocd = text(original.ocdId), local = filed?.some(place => !STATE_LEVEL.test(place)) ?? false;
    const also = original.alsoServesOcdIds as string[] | undefined;
    if (!(ocd !== null && selected.has(ocd) && (!STATE_LEVEL.test(ocd) || !local) || filed?.some(place => selected.has(place)) || also?.some(place => selected.has(place)) || held.has(board))) return;
    const body = stored({ ...original, ...(board === id ? {} : { id: board, name: input.names.get(board) ?? original.name }),
      ocdId: ocd !== null && local && STATE_LEVEL.test(ocd) ? null : ocd, ...(filed ? { alsoServesOcdIds: [...filed, ...also ?? []] } : {}) });
    if (!chosen.has(board) || chosen.get(board)!.alias && board === id) chosen.set(board, { body, alias: board !== id, at });
  });
  const bodies = [...chosen.values()].sort((a, b) => a.at - b.at).map(row => row.body);
  const ids = new Set(bodies.map(body => String(body.id))), allBoards = new Set([...ids, ...held]);
  const divisions = new Set([...selected, ...bodies.flatMap(body => text(body.ocdId) ?? [])]);
  for (const division of divisions) { const parent = text(rows(model.registry.divisions).find(row => row.ocdId === division)?.parentOcdId); if (parent) divisions.add(parent); }
  const rosters = model.bodyRosters.filter(roster => allBoards.has(canon(roster.bodyId))).map(roster => canon(roster.bodyId) === roster.bodyId ? roster : { ...roster, bodyId: canon(roster.bodyId) });
  const people = new Set([...input.peopleIds ?? [], ...rosters.flatMap(roster => roster.members.flatMap(member => [member.id, member.personId, member.sourceRecordId,
    ...Object.values(member.nativeIds ?? {}).flat()])), ...model.statewideExecutives.filter(executive => selected.has(String(executive.stateOcdId))).map(executive => executive.holder.id)].filter((id): id is string => !!id));
  const candidacies = model.officialCandidacies.rows.filter(row => people.has(row.holder.id) || row.holder.divisions.some(id => divisions.has(id)));
  const holders = new Set([...people, ...candidacies.map(row => row.holder.id)]);
  const photos = model.officialPhotos.photos.filter(photo => holders.has(photo.officeholderId) || (photo.personId !== undefined && people.has(photo.personId)));
  const photoOwners = new Set([...people, ...photos.map(photo => photo.officeholderId)]);
  return { ...model,
    registry: { ...model.registry, bodies: bodies as never, divisions: model.registry.divisions.filter(division => divisions.has(division.ocdId)) },
    bodyRosters: rosters,
    rosterReaderDispositions: model.rosterReaderDispositions.filter(row => people.has(row.sourceId) || row.canonicalId !== null && people.has(row.canonicalId) || [...allBoards].some(board => row.sourceId.startsWith(`roster:${board}#`))),
    statewideExecutives: model.statewideExecutives.filter(executive => selected.has(String(executive.stateOcdId))),
    officialCandidacies: { ...model.officialCandidacies, rows: candidacies }, officialPhotos: { ...model.officialPhotos, photos },
    rosterPhotos: Object.fromEntries(Object.entries(model.rosterPhotos).filter(([id]) => photoOwners.has(id))) };
}
