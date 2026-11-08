import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { STATE_GEOMETRY_MANIFEST, stateGeometryPath } from "../geo/state-geometry.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { MEMBER_OFFICE_NATIONAL_SCOPE } from "../officials/member-office-data.ts";
import { memberOfficeStateScope } from "../officials/member-office-scope.ts";
import { processNeonBytes } from "../db/transfer-by-caller.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { withPlaceMapReads } from "../place-map/reader.ts";
import { purgeReaderCacheTags, type ReaderCachePurger } from "./cache.ts";
import { publicationVersion } from "./canonical.ts";
import { buildPlaceFile, PLACE_FILE_PAGE_SQL, readChecks } from "./place-file-build.ts";
import { contentHash, fileHash, type PlaceFile } from "./place-file.ts";
import { getFile, indexPointerKey, putFile, READER_INDEX_TAG, type NationalFile } from "./place-files.ts";
import { buildMapIndex, buildZipRows, easternDay, localKey, placeMeta, readPublished, readZipPlaces, type BoardsIndex, type IndexPointer, type MapIndex, type PlaceMeta, type ZipPlaces } from "./place-index.ts";
import { cutState, stateDivisionId } from "./state-share.ts";
import { readStatePackage, zipStateSources } from "./state.ts";
import { READER_ZIP3_TAG, zip3Key, type Zip3File, type ZipRow } from "./zip3.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const PLACE_FILES_JOB = { id: "place-files", databaseBytesPerRun: 60_000_000 } as const;
/** What the lane may move an hour from the database: a state's package, the saved pages it files, and claiming and finishing. Each look puts the time its bytes take on a tab, kept across the lane's starts. */
export const PLACE_FILE_BYTES_PER_HOUR = 60_000_000;
/** Places filed in one look; they are built one after another, so only one page is in memory at a time. */
const BATCH = 100;
/** A file whose only change is a check date is filed again at most this often. */
const CHECK_EVERY_MS = 86_400_000;
const IDLE_MS = 10_000, BUSY_PAUSE_MS = 1_000, STATES_EVERY_MS = 5 * 60_000, NATIONAL_EVERY_MS = 60_000;
const PAGES_CURSOR = "place-files:pages", STATES_CURSOR = "place-files:states", CHECKS_CURSOR = "place-files:checks", TAB_CURSOR = "place-files:tab";
/** The variants whose dates a reader of a ZIP sees; the longer look at a place's history keeps the dates it was filed with until its page is built again. */
const DATED = ["current", "emptyCurrent"] as const;

export const placeFilesLane = (run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane => ({ id: PLACE_FILES_JOB.id, everyMs: 60_000, budgetMs: 55 * 60_000, run });
const databaseBytesSpent = (): number => processNeonBytes().reduce((sum, hour) => sum + hour.bytes.reader + hour.bytes["control-plane"] + (hour.sent?.reader.bytes ?? 0) + (hour.sent?.["control-plane"].bytes ?? 0), 0);
/** The time owed for the bytes moved, 5% over what the meter counts. */
export const owedMs = (bytes: number): number => Math.ceil(bytes * 1.05 / PLACE_FILE_BYTES_PER_HOUR * 3_600_000);

export interface PlaceFilesDeps {
  readonly facts: Query;
  readonly store: ReaderArtifactStore;
  readonly purge?: ReaderCachePurger;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** The national file's content as the national shelf holds it. */
  readonly national: () => Promise<Omit<NationalFile, "v">>;
  /** Asks for the new answers of the busiest ZIPs once they are published, a few at a time, so readers find them kept (see answer-warm.ts). */
  readonly warm?: () => Promise<number>;
}

/** A state's published files as the lane holds them. */
interface Held { pointer: IndexPointer | null; etag: string | null; files: Map<string, string>; meta: Map<string, PlaceMeta>; zips: Record<string, ZipPlaces>; shared: Set<string> }
interface Pass { state: string; todo: string[]; done: number }
type Cut = ReturnType<typeof cutState>;
const memory = { national: "", nationalCheckedAt: 0, statesCheckedAt: 0, held: new Map<string, Held>(), pass: undefined as Pass | undefined, cut: undefined as Cut | undefined,
  aliases: undefined as Record<string, string> | undefined, tab: { until: 0, loaded: false }, unpurged: new Set<string>(), rows: new Map<string, { file: Zip3File; etag: string | null }>(), day: "" };

/** Lets go of everything the lane holds in memory. */
export function closePlaceFilesLane(): void {
  Object.assign(memory, { national: "", nationalCheckedAt: 0, statesCheckedAt: 0, pass: undefined, cut: undefined, aliases: undefined, tab: { until: 0, loaded: false }, day: "" });
  memory.held.clear(); memory.unpurged.clear(); memory.rows.clear();
}

/** The rows of a prefix as the store holds them, kept with the etag they were read at, so a write replaces them only if nothing else did. */
async function rowsOf(deps: PlaceFilesDeps, prefix: string): Promise<{ file: Zip3File; etag: string | null }> {
  const have = memory.rows.get(prefix);
  if (have) return have;
  const read = await deps.store.readJsonPointer<Zip3File>(zip3Key(prefix)), found = { file: read?.value ?? { v: 1 as const, zips: {} }, etag: read?.etag ?? null };
  memory.rows.set(prefix, found);
  return found;
}

async function held(deps: PlaceFilesDeps, state: string): Promise<Held> {
  const have = memory.held.get(state);
  if (have) return have;
  const pointer = await deps.store.readJsonPointer<IndexPointer>(indexPointerKey(state));
  const map = pointer && await getFile<MapIndex>(deps.store, pointer.value.map, true);
  const boards = pointer && await getFile<BoardsIndex>(deps.store, pointer.value.boards, true);
  const rows = pointer ? await Promise.all(pointer.value.prefixes.map(async prefix => (await rowsOf(deps, prefix)).file)) : [];
  const known = map && boards ? readPublished(state, map, boards, rows) : { files: new Map<string, string>(), meta: new Map<string, PlaceMeta>(), zips: {} };
  const own = known.files.get(stateDivisionId(state)), file = own ? await getFile<PlaceFile>(deps.store, own, true) : null;
  const result: Held = { pointer: pointer?.value ?? null, etag: pointer?.etag ?? null, ...known, shared: new Set((file?.wide as { shared?: string[] } | undefined)?.shared) };
  memory.held.set(state, result);
  return result;
}

/** Arizona's boards come from a bundled territory file, so its version is part of every Arizona answer. */
function territoryVersion(state: string): string {
  if (state !== "AZ") return "";
  try { return (JSON.parse(readFileSync(STATE_GEOMETRY_MANIFEST, "utf8")) as { files: Record<string, { sha256?: string }> }).files[stateGeometryPath("az", "body-territories.geojson")]?.sha256?.slice(0, 16) ?? ""; }
  catch { return ""; }
}

/** Files a value under its hash unless it is the one already named. */
async function putUnless(store: ReaderArtifactStore, value: unknown, current: string | undefined): Promise<string> {
  return fileHash(value) === current ? current! : (await putFile(store, value)).name;
}

/**
 * Files the state's map index, moves its pointer, and then writes the rows of the prefixes whose ZIPs changed, so the answer a row names is always made from
 * files the pointer already names. A prefix is shared by every state with ZIPs in it, so a state replaces only the rows it is the first state of. A ZIP across a
 * state line has one key for every state it touches, so the other states are brought up to it. Returns the tags to clear.
 */
async function commit(deps: PlaceFilesDeps, state: string, refresh: readonly string[], crossing = true): Promise<string[]> {
  const have = await held(deps, state), national = memory.national || have.pointer?.national || "", now = new Date((deps.now ?? Date.now)());
  const stale = new Set(refresh);
  for (const row of await placeMeta(deps.facts, [...have.files.keys()].filter(id => !have.meta.has(id) || stale.has(id)))) have.meta.set(row.id, row);
  const others = new Set(Object.values(have.zips).flatMap(row => row.states).filter(other => other !== state));
  for (const other of others) await held(deps, other);
  const ready = (zip: string) => have.zips[zip]!.states.every(other => other === state || memory.held.get(other)?.pointer);
  const made = buildZipRows(state, have.files, Object.fromEntries(Object.entries(have.zips).filter(([zip]) => ready(zip))), national, territoryVersion(state), (zip, other, row) => {
    const there = memory.held.get(other)!;
    return { key: localKey(other, there.files, there.zips[zip] ?? row, national, territoryVersion(other)), districts: (there.zips[zip]?.districts ?? []).filter(id => there.files.has(id)) };
  }, now);
  const { map, boards } = buildMapIndex(state, have.files, have.meta);
  const next: IndexPointer = { map: await putUnless(deps.store, map, have.pointer?.map), boards: await putUnless(deps.store, boards, have.pointer?.boards), national,
    prefixes: [...new Set(Object.keys(have.zips).map(zip => zip.slice(0, 3)))].sort() };
  const tags: string[] = [], before = have.pointer?.prefixes ?? [];
  if (!have.pointer || JSON.stringify(have.pointer) !== JSON.stringify(next)) {
    const moved = await deps.store.writeJsonPointer<IndexPointer>(indexPointerKey(state), next, have.etag);
    if (!moved.modified) { memory.held.delete(state); throw new Error(`PLACE_INDEX_MOVED:${state}`); }
    have.pointer = next; have.etag = moved.etag;
    tags.push(READER_INDEX_TAG(state));
  }
  for (const prefix of new Set([...Object.keys(made), ...next.prefixes, ...before])) {
    const stored = await rowsOf(deps, prefix), zips: Record<string, ZipRow> = {};
    for (const [zip, row] of Object.entries(stored.file.zips)) if (row.states[0] !== state) zips[zip] = row;
    Object.assign(zips, made[prefix]);
    const file: Zip3File = { v: 1, zips: Object.fromEntries(Object.entries(zips).sort(([a], [b]) => a < b ? -1 : 1)) };
    if (JSON.stringify(file) === JSON.stringify(stored.file)) continue;
    const wrote = await deps.store.writeJsonPointer<Zip3File>(zip3Key(prefix), file, stored.etag);
    if (!wrote.modified) { memory.rows.delete(prefix); throw new Error(`PLACE_ROWS_MOVED:${prefix}`); }
    memory.rows.set(prefix, { file, etag: wrote.etag });
    tags.push(READER_ZIP3_TAG(prefix));
  }
  if (crossing && tags.length) for (const other of others) if ((await held(deps, other)).pointer) tags.push(...await commit(deps, other, [], false));
  return tags;
}

/** Purge only after every file and pointer of the look is written; a refused purge is tried again at the next look. */
async function clear(deps: PlaceFilesDeps, tags: readonly string[]): Promise<void> {
  for (const tag of tags) memory.unpurged.add(tag);
  if (!memory.unpurged.size) return;
  const result = await (deps.purge ?? purgeReaderCacheTags)([...memory.unpurged]);
  if (result.purged) memory.unpurged.clear(); else deps.log?.(`Place files: the CDN was not cleared (${result.detail ?? "refused"}); it is tried again`);
}

/** The President and Vice President: the records the national file keeps of the executive (the cabinet's cards are read from their own source). */
function presidentAndVice(roster: { officeholders: { id: string; officeTitle?: string }[]; divisions: { officeholderId: string }[] } | null) {
  if (!roster) return null;
  const keep = new Set(roster.officeholders.filter(holder => /^(Vice )?President\b/.test(holder.officeTitle ?? "")).map(holder => holder.id));
  return { ...roster, officeholders: roster.officeholders.filter(holder => keep.has(holder.id)), divisions: roster.divisions.filter(link => keep.has(link.officeholderId)), unmatched: [] };
}

/** The national file is filed once and every published state is pointed to it. */
async function syncNational(deps: PlaceFilesDeps, now: number): Promise<string[]> {
  if (memory.nationalCheckedAt && now - memory.nationalCheckedAt < NATIONAL_EVERY_MS) return [];
  memory.nationalCheckedAt = now;
  const read = await deps.national();
  const filed = await putFile(deps.store, { v: 1, president: presidentAndVice(read.president as Parameters<typeof presidentAndVice>[0]), routing: read.routing } satisfies NationalFile);
  if (filed.name === memory.national) return [];
  memory.national = filed.name;
  const tags: string[] = [];
  for (const state of REGISTRY_STATES) if ((await held(deps, state)).pointer) tags.push(...await commit(deps, state, [], false));
  deps.log?.("Place files: the national file changed; every state points to it");
  return tags;
}

/** Files one place when what it says differs from what is filed; returns whether its file is new. A date-only change waits for `checks`. */
async function file(deps: PlaceFilesDeps, have: Held, next: PlaceFile, now: number, checks = false): Promise<boolean> {
  const name = have.files.get(next.id), prior = name ? await getFile<PlaceFile>(deps.store, name, true) : null;
  if (prior && contentHash(prior) === contentHash(next) && (JSON.stringify(prior.variants) === JSON.stringify(next.variants) || !checks && now - prior.readAt < CHECK_EVERY_MS)) return false;
  const filed = await putFile(deps.store, { ...next, readAt: now });
  have.files.set(next.id, filed.name);
  return filed.name !== name;
}

/* ---- the Eastern day turned ------------------------------------------------------------------------------------------ */

/** A row names the Eastern day its answer shows, so when the day turns every published state's rows are written again with the new day's keys. */
async function dayTurn(deps: PlaceFilesDeps, now: number): Promise<string[]> {
  const day = easternDay(new Date(now));
  if (memory.day === day) return [];
  const tags: string[] = [];
  for (const state of REGISTRY_STATES) if ((await held(deps, state)).pointer) tags.push(...await commit(deps, state, [], false));
  memory.day = day;
  return tags;
}

/* ---- a saved page changed ------------------------------------------------------------------------------------------- */

async function pagesTurn(deps: PlaceFilesDeps, now: number): Promise<{ readonly considered: number; readonly tags: string[] }> {
  const saved = await readPassCursor(deps.facts, PAGES_CURSOR);
  const mark = saved ? JSON.parse(saved) as { at: string; id: string } : { at: new Date(now).toISOString(), id: "" };
  if (!saved) await writePassCursor(deps.facts, PAGES_CURSOR, JSON.stringify(mark));
  const pages = await deps.facts(`${PLACE_FILE_PAGE_SQL} AND (p.built_at,p.place_id)>($1::timestamptz,$2::text) ORDER BY p.built_at,p.place_id LIMIT $3`, [mark.at, mark.id, BATCH]);
  if (!pages.length) return { considered: 0, tags: [] };
  const tags: string[] = [];
  for (const state of new Set(pages.flatMap(page => page.state ? [String(page.state).trim()] : []))) {
    const have = await held(deps, state), changed: string[] = [];
    // A state is first filled by its own pass, which reads its pages as they are then.
    if (!have.pointer) continue;
    for (const page of pages.filter(row => String(row.state).trim() === state)) {
      const next = await buildPlaceFile(deps.facts, page), prior = have.files.get(next.id), kept = prior ? await getFile<PlaceFile>(deps.store, prior, true) : null;
      if (await file(deps, have, { ...next, ...(kept?.share ? { share: kept.share } : {}), ...(kept?.wide ? { wide: kept.wide } : {}), ...(kept?.aliases ? { aliases: kept.aliases } : {}) }, now)) changed.push(next.id);
    }
    if (changed.length) tags.push(...await commit(deps, state, changed));
  }
  const last = pages.at(-1)!;
  await writePassCursor(deps.facts, PAGES_CURSOR, JSON.stringify({ at: String(last.built_text), id: String(last.id) }));
  return { considered: pages.length, tags };
}

/* ---- facts were checked again -------------------------------------------------------------------------------------- */

/**
 * Once a day, the places whose facts were checked in the day since the last look get their dates read again. Only those places are named (by the
 * entities their pages depend on), only the dates are read, and a place's file is filed again only if a date moved.
 */
async function checksTurn(deps: PlaceFilesDeps, now: number): Promise<{ readonly considered: number; readonly tags: string[] } | null> {
  const saved = await readPassCursor(deps.facts, CHECKS_CURSOR);
  const c = saved ? JSON.parse(saved) as { at: string; to?: string; after: string } : { at: new Date(now).toISOString(), after: "" };
  if (!saved) await writePassCursor(deps.facts, CHECKS_CURSOR, JSON.stringify(c));
  if (!c.to) {
    if (now - Date.parse(c.at) < CHECK_EVERY_MS) return null;
    c.to = new Date(now).toISOString(); c.after = "";
  }
  const places = await deps.facts(`SELECT p.place_id AS id,e.state FROM place_page p JOIN entity e ON e.id=p.place_id
    WHERE p.depends && ARRAY(SELECT DISTINCT f.entity_id FROM fact_confirmation c JOIN fact f ON f.id=ANY(c.fact_ids) WHERE c.checked_at>$1::timestamptz AND c.checked_at<=$2::timestamptz) AND p.place_id>$3 ORDER BY p.place_id LIMIT $4`, [c.at, c.to, c.after, BATCH]);
  const tags: string[] = [], changed = new Map<string, string[]>();
  for (const { id, state } of places.map(row => ({ id: String(row.id), state: String(row.state ?? "").trim() }))) {
    const have = state ? await held(deps, state) : null, name = have?.files.get(id), prior = name ? await getFile<PlaceFile>(deps.store, name, true) : null;
    if (!have?.pointer || !prior) continue;
    const variants = Object.fromEntries(await Promise.all(Object.entries(prior.variants).map(async ([key, variant]) =>
      [key, (DATED as readonly string[]).includes(key) ? { ...variant, checks: await readChecks(deps.facts, variant!.row) } : variant] as const)));
    if (await file(deps, have, { ...prior, variants } as PlaceFile, now, true)) changed.set(state, [...changed.get(state) ?? [], id]);
  }
  for (const [state, ids] of changed) tags.push(...await commit(deps, state, ids));
  if (places.length < BATCH) { c.at = c.to; delete c.to; c.after = ""; } else c.after = String(places.at(-1)!.id);
  await writePassCursor(deps.facts, CHECKS_CURSOR, JSON.stringify(c));
  return { considered: places.length, tags };
}

/* ---- a state's inputs moved ----------------------------------------------------------------------------------------- */

interface States { prints: Record<string, string>; active?: { state: string; print: string; done: number; first: boolean } }

/** What moves when a state's files should be cut again: its published entries, the member offices and owner choices beside them, and its place map. One small read each. */
export async function statePrint(facts: Query, state: string): Promise<string> {
  const { keys, candidates, translations } = zipStateSources(state);
  const read: ReadOnlyQuery = statements => Promise.all(statements.map(statement => facts(statement.text, statement.params)));
  const version = await publicationVersion([...keys, ...candidates, ...[memberOfficeStateScope(state), MEMBER_OFFICE_NATIONAL_SCOPE].map(scope => `CURATED_READER_RECORD:${scope}`)], read, translations);
  const [owner] = await facts(`SELECT md5(coalesce(string_agg(o::text,'|' ORDER BY o.id),'')) AS value FROM owner_flag o
    WHERE o.reader_family IN ('campaign-sites','member-offices') AND o.resolved IN ('REMOVE','TYPED_VALUE')`);
  const [map] = await facts(`SELECT count(*)::text||':'||coalesce(max(m.boundary_year),0)::text AS value FROM zip_place m
    JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE e.state=$1::char(2)`, [state]);
  return createHash("sha256").update([version, owner?.value, map?.value].join("|")).digest("hex").slice(0, 32);
}

/** The states whose inputs moved or that have no files yet, the most populated first. */
async function dueStates(facts: Query, prints: Record<string, string>): Promise<{ state: string; print: string }[]> {
  const rows = await facts(`SELECT state,sum(page_priority) AS weight FROM entity WHERE id ~ '^zip:[0-9]{5}$' GROUP BY state`);
  const weight = new Map(rows.map(row => [String(row.state), Number(row.weight ?? 0)]));
  const due: { state: string; print: string }[] = [];
  for (const state of REGISTRY_STATES) {
    if (!weight.has(state)) continue;
    const print = await statePrint(facts, state);
    if (prints[state] !== print) due.push({ state, print });
  }
  return due.sort((a, b) => (weight.get(b.state) ?? 0) - (weight.get(a.state) ?? 0));
}

/** Reads the state's package once and cuts it by division. Only the cut is kept: the package is let go as soon as it is cut. */
function cutOnce(deps: PlaceFilesDeps, state: string): Promise<Cut> {
  return withPlaceMapReads(async () => {
    const registration = await readRegistrationProjection(state), [{ zip }] = await deps.facts(`SELECT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE e.state=$1::char(2) LIMIT 1`, [state]) as { zip: string }[];
    const divisions = registration.kind === "PROMOTED" || registration.kind === "BOOTSTRAP" ? registration.value.divisions as unknown as Record<string, unknown>[] : [];
    // The small reads first: the whole package is the largest thing the lane holds, and nothing else is held beside it.
    const probe = await readStatePackage(state, [stateDivisionId(state)], zip, { earlyDistricts: true });
    return cutState(await readStatePackage(state), divisions, probe);
  });
}

async function statePass(deps: PlaceFilesDeps, now: number): Promise<{ readonly considered: number; readonly tags: string[] } | null> {
  const saved = await readPassCursor(deps.facts, STATES_CURSOR);
  const c: States = saved ? JSON.parse(saved) as States : { prints: {} };
  if (!c.active) {
    if (memory.statesCheckedAt && now - memory.statesCheckedAt < STATES_EVERY_MS) return null;
    memory.statesCheckedAt = now;
    const [next] = await dueStates(deps.facts, c.prints);
    if (!next) return null;
    c.active = { ...next, done: 0, first: !(await held(deps, next.state)).pointer };
    memory.pass = undefined;
    deps.log?.(`Place files: ${next.state} is read`);
  }
  const { state, first } = c.active, have = await held(deps, state), own = stateDivisionId(state);
  if (!memory.cut || memory.pass?.state !== state) {
    memory.cut = await cutOnce(deps, state);
    memory.aliases = Object.fromEntries((await deps.facts(`SELECT x.value,x.entity_id FROM entity_external_id x JOIN entity b ON b.id=x.entity_id AND b.state=$1::char(2) WHERE x.scheme='body-alias'`, [state]))
      .map(row => [String(row.value), String(row.entity_id)]));
    // The busiest places first. After the first fill, only the places that hold or held a share are looked at again.
    const wanted = first ? null : [...new Set([...memory.cut.shares.keys(), ...have.shared])];
    const ids = (await deps.facts(`SELECT e.id FROM entity e ${wanted ? "" : "JOIN place_page p ON p.place_id=e.id AND p.context ? 'current'"} WHERE e.state=$1::char(2) AND e.kind IN ('place','body')
      ${wanted ? "AND e.id=ANY($2::text[])" : ""} ORDER BY e.page_priority DESC,e.id`, wanted ? [state, wanted] : [state])).map(row => String(row.id));
    memory.pass = { state, todo: [...new Set([...ids, ...(first ? [...memory.cut.shares.keys()] : [])])], done: c.active.done };
  }
  const pass = memory.pass!, cut = memory.cut!, batch = pass.todo.slice(pass.done, pass.done + BATCH), fresh: string[] = [];
  const pages = new Map((await deps.facts(`${PLACE_FILE_PAGE_SQL} AND p.place_id=ANY($1::text[])`, [batch.filter(id => !have.files.has(id))])).map(row => [String(row.id), row]));
  for (const id of batch) {
    const name = have.files.get(id), kept = name ? await getFile<PlaceFile>(deps.store, name, true) : null, page = pages.get(id);
    const base = kept ?? (page ? await buildPlaceFile(deps.facts, page) : { v: 1 as const, id, kind: "place" as const, state, version: 0, builtAt: 0, readAt: now, variants: {} });
    const share = cut.shares.get(id);
    if (share) have.shared.add(id); else have.shared.delete(id);
    if (await file(deps, have, { ...base, share, ...(id === own ? { wide: { ...cut.wide, shared: [...have.shared] }, aliases: memory.aliases } : {}) }, now)) fresh.push(id);
  }
  pass.done += batch.length;
  const finished = pass.done >= pass.todo.length;
  if (finished) have.zips = await readZipPlaces(state, cut.zipDistricts);
  const tags = fresh.length || finished ? await commit(deps, state, finished ? [...have.files.keys()] : fresh) : [];
  if (finished) {
    c.prints[state] = c.active.print; delete c.active; memory.statesCheckedAt = 0; memory.pass = undefined; memory.cut = undefined; memory.aliases = undefined;
    deps.log?.(`Place files: ${state} is done`);
  } else c.active.done = pass.done;
  await writePassCursor(deps.facts, STATES_CURSOR, JSON.stringify(c));
  return { considered: batch.length, tags };
}

export interface PlaceFilesTurn { readonly considered: number; readonly kind: "pages" | "checks" | "state" | "idle" }

/** One look: the national file, then a changed saved page, then the day's checked dates, then the next of a state's pass. */
export async function placeFilesTurn(deps: PlaceFilesDeps): Promise<PlaceFilesTurn> {
  const now = (deps.now ?? Date.now)(), tags = await syncNational(deps, now);
  tags.push(...await dayTurn(deps, now));
  let turn: PlaceFilesTurn = { considered: 0, kind: "idle" };
  const pages = await pagesTurn(deps, now);
  if (pages.considered) { tags.push(...pages.tags); turn = { considered: pages.considered, kind: "pages" }; }
  else {
    const checks = await checksTurn(deps, now);
    if (checks?.considered) { tags.push(...checks.tags); turn = { considered: checks.considered, kind: "checks" }; }
    else {
      const pass = await statePass(deps, now);
      if (pass) { tags.push(...pass.tags); turn = { considered: pass.considered, kind: "state" }; }
    }
  }
  await clear(deps, tags);
  return turn;
}

/** The lane's turn: keeps looking until it is asked to stop, resting while the tab is owed so everything it does stays within its pace. */
export async function runPlaceFilesLane(input: { readonly deps: PlaceFilesDeps; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>; readonly total?: { considered: number } }): Promise<{ readonly considered: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { considered: 0 }, { facts } = input.deps, clock = input.deps.now ?? Date.now, tab = memory.tab, log = input.deps.log ?? (() => {});
  if (!tab.loaded) { tab.until = Number(await readPassCursor(facts, TAB_CURSOR) ?? 0); tab.loaded = true; }
  try {
    while (!input.stopRequested()) {
      const start = clock();
      if (start < tab.until) { await sleep(Math.min(tab.until - start, IDLE_MS)); continue; }
      const before = databaseBytesSpent();
      let turn: PlaceFilesTurn | undefined;
      try { turn = await placeFilesTurn(input.deps); }
      catch (error) { if (!input.turnEnd?.aborted) log(`Place files: a look failed (${error instanceof Error ? error.message : String(error)}); it is made again`); }
      try { await input.deps.warm?.(); }
      catch (error) { log(`Place files: warming answers failed (${error instanceof Error ? error.message : String(error)})`); }
      tab.until = start + owedMs(Math.max(0, databaseBytesSpent() - before));
      if (turn?.considered) { total.considered += turn.considered; log(`Place files: ${turn.considered} places looked at (${turn.kind})`); }
      if (!turn || turn.considered) await writePassCursor(facts, TAB_CURSOR, String(tab.until)).catch(() => undefined);
      if (input.turnEnd?.aborted) break;
      await sleep(turn?.considered ? BUSY_PAUSE_MS : IDLE_MS);
    }
  } finally { closePlaceFilesLane(); }
  return total;
}
