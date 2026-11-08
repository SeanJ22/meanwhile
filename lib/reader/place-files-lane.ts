import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { processNeonBytes } from "../db/transfer-by-caller.ts";
import { readStateZipPlaces, withPlaceMapReads } from "../place-map/reader.ts";
import { createHash } from "node:crypto";
import { purgeReaderCacheTags, type ReaderCachePurger } from "./cache.ts";
import { publicationVersion } from "./canonical.ts";
import { buildPlaceFile, PLACE_FILE_PAGE_SQL } from "./place-file-build.ts";
import { contentHash, type PlaceFile } from "./place-file.ts";
import { getFile, indexPointerKey, putFile, READER_INDEX_TAG, type IndexPointer, type NationalFile } from "./place-files.ts";
import { buildPlaceIndex, placeMeta, readPlaceIndex, readZipPlaces, stateAliases, type PlaceIndex, type PlaceMeta, type ZipPlaces } from "./place-index.ts";
import { copiedRegistration, mirrorScopes, type StateMirror } from "./state-mirror.ts";
import { cutState, stateDivisionId } from "./state-share.ts";
import { forgetNationalShelf } from "./shelf.ts";
import { readStatePackage } from "./state.ts";
import { withStateSeam } from "./state-seam.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const PLACE_FILES_JOB = { id: "place-files", databaseBytesPerRun: 60_000_000 } as const;
/** What the lane may move an hour from the database: a state's copy, the saved pages it files, and claiming and finishing. Each look puts the time its bytes take on a tab, kept across the lane's starts. */
export const PLACE_FILE_BYTES_PER_HOUR = 60_000_000;
/** Places filed in one look; they are built one after another, so only one page is in memory at a time. */
const BATCH = 100;
/** A file whose only change is a check date is filed again at most this often. */
const CHECK_ONLY_EVERY_MS = 86_400_000;
const IDLE_MS = 10_000, BUSY_PAUSE_MS = 1_000, STATES_EVERY_MS = 5 * 60_000, NATIONAL_EVERY_MS = 60_000;
const PAGES_CURSOR = "place-files:pages", STATES_CURSOR = "place-files:states", TAB_CURSOR = "place-files:tab";

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
  /** Copies one state's inputs once. */
  readonly openMirror: (state: string) => Promise<StateMirror>;
}

/** A state's published index as the lane holds it. */
interface Held { pointer: IndexPointer | null; etag: string | null; files: Map<string, string>; meta: Map<string, PlaceMeta>; zips: Record<string, ZipPlaces>; aliases: Record<string, string>; shared: Set<string> }
interface Pass { state: string; todo: string[]; done: number }
type Cut = ReturnType<typeof cutState>;
const memory = { national: "", nationalCheckedAt: 0, statesCheckedAt: 0, held: new Map<string, Held>(), pass: undefined as Pass | undefined, cut: undefined as Cut | undefined,
  tab: { until: 0, loaded: false }, unpurged: new Set<string>() };

/** Lets go of everything the lane holds in memory. */
export function closePlaceFilesLane(): void {
  Object.assign(memory, { national: "", nationalCheckedAt: 0, statesCheckedAt: 0, pass: undefined, cut: undefined, tab: { until: 0, loaded: false } });
  memory.held.clear(); memory.unpurged.clear();
}

async function held(deps: PlaceFilesDeps, state: string): Promise<Held> {
  const have = memory.held.get(state);
  if (have) return have;
  const pointer = await deps.store.readJsonPointer<IndexPointer>(indexPointerKey(state));
  const index = pointer && await getFile<PlaceIndex>(deps.store, pointer.value.index, true);
  const known = index ? readPlaceIndex(index) : { files: new Map<string, string>(), meta: new Map<string, PlaceMeta>(), zips: {} };
  const own = known.files.get(stateDivisionId(state)), file = own ? await getFile<PlaceFile>(deps.store, own, true) : null;
  const result: Held = { pointer: pointer?.value ?? null, etag: pointer?.etag ?? null, ...known, aliases: { ...index?.aliases }, shared: new Set((file?.wide as { shared?: string[] } | undefined)?.shared) };
  memory.held.set(state, result);
  return result;
}

/** Files the state's index, then moves its pointer, so a reader of the pointer always finds every file the index names. Returns the tag to clear. */
async function commit(deps: PlaceFilesDeps, state: string, have: Held, refresh: readonly string[]): Promise<string | null> {
  const national = have.pointer?.national ?? memory.national;
  const stale = new Set(refresh);
  for (const row of await placeMeta(deps.facts, [...have.files.keys()].filter(id => !have.meta.has(id) || stale.has(id)))) have.meta.set(row.id, row);
  const filed = await putFile(deps.store, buildPlaceIndex(state, national, have.files, have.meta, have.aliases, have.zips));
  if (have.pointer?.index === filed.name && have.pointer.national === national) return null;
  const moved = await deps.store.writeJsonPointer<IndexPointer>(indexPointerKey(state), { index: filed.name, national }, have.etag);
  if (!moved.modified) { memory.held.delete(state); throw new Error(`PLACE_INDEX_MOVED:${state}`); }
  have.pointer = { index: filed.name, national }; have.etag = moved.etag;
  return READER_INDEX_TAG(state);
}

/** Purge only after every file and pointer of the look is written; a refused purge is tried again at the next look. */
async function clear(deps: PlaceFilesDeps, tags: readonly (string | null)[]): Promise<void> {
  for (const tag of tags) if (tag) memory.unpurged.add(tag);
  if (!memory.unpurged.size) return;
  const result = await (deps.purge ?? purgeReaderCacheTags)([...memory.unpurged]);
  if (result.purged) memory.unpurged.clear(); else deps.log?.(`Place files: the CDN was not cleared (${result.detail ?? "refused"}); it is tried again`);
}

/** The national file is filed once and every published state's index is pointed to it. */
async function syncNational(deps: PlaceFilesDeps, now: number): Promise<string[]> {
  if (memory.nationalCheckedAt && now - memory.nationalCheckedAt < NATIONAL_EVERY_MS) return [];
  memory.nationalCheckedAt = now;
  const filed = await putFile(deps.store, { v: 1, ...await deps.national() } satisfies NationalFile);
  if (filed.name === memory.national) return [];
  memory.national = filed.name;
  const tags: string[] = [];
  for (const state of REGISTRY_STATES) {
    const have = await held(deps, state);
    if (!have.pointer || have.pointer.national === filed.name) continue;
    const index = await getFile<PlaceIndex>(deps.store, have.pointer.index, true);
    if (!index) continue;
    const next = await putFile(deps.store, { ...index, national: filed.name });
    const moved = await deps.store.writeJsonPointer<IndexPointer>(indexPointerKey(state), { index: next.name, national: filed.name }, have.etag);
    if (moved.modified) { have.pointer = { index: next.name, national: filed.name }; have.etag = moved.etag; tags.push(READER_INDEX_TAG(state)); } else memory.held.delete(state);
  }
  deps.log?.("Place files: the national file changed; every state's index points to it");
  return tags;
}

/** Files one place when what it says differs from what is filed; returns whether its file is new. */
async function file(deps: PlaceFilesDeps, have: Held, next: PlaceFile, now: number): Promise<boolean> {
  const name = have.files.get(next.id), prior = name ? await getFile<PlaceFile>(deps.store, name, true) : null;
  // Only the dates its facts were checked may have moved: they are filed again at most once a day.
  if (prior && contentHash(prior) === contentHash(next) && (JSON.stringify(prior.variants) === JSON.stringify(next.variants) || now - prior.readAt < CHECK_ONLY_EVERY_MS)) return false;
  const filed = await putFile(deps.store, { ...next, readAt: now });
  have.files.set(next.id, filed.name);
  return filed.name !== name;
}

/* ---- a saved page changed ------------------------------------------------------------------------------------------- */

async function pagesTurn(deps: PlaceFilesDeps, now: number): Promise<{ readonly considered: number; readonly tags: (string | null)[] }> {
  const saved = await readPassCursor(deps.facts, PAGES_CURSOR);
  const mark = saved ? JSON.parse(saved) as { at: string; id: string } : { at: new Date(now).toISOString(), id: "" };
  if (!saved) await writePassCursor(deps.facts, PAGES_CURSOR, JSON.stringify(mark));
  const pages = await deps.facts(`${PLACE_FILE_PAGE_SQL} AND (p.built_at,p.place_id)>($1::timestamptz,$2::text) ORDER BY p.built_at,p.place_id LIMIT $3`, [mark.at, mark.id, BATCH]);
  if (!pages.length) return { considered: 0, tags: [] };
  const tags: (string | null)[] = [];
  for (const state of new Set(pages.flatMap(page => page.state ? [String(page.state).trim()] : []))) {
    const have = await held(deps, state), changed: string[] = [];
    // A state is first filled by its own pass, which reads its pages as they are then.
    if (!have.pointer) continue;
    for (const page of pages.filter(row => String(row.state).trim() === state)) {
      const next = await buildPlaceFile(deps.facts, page), prior = have.files.get(next.id), kept = prior ? await getFile<PlaceFile>(deps.store, prior, true) : null;
      if (await file(deps, have, { ...next, ...(kept?.share ? { share: kept.share } : {}), ...(kept?.wide ? { wide: kept.wide } : {}) }, now)) changed.push(next.id);
    }
    if (changed.length) tags.push(await commit(deps, state, have, changed));
  }
  const last = pages.at(-1)!;
  await writePassCursor(deps.facts, PAGES_CURSOR, JSON.stringify({ at: String(last.built_text), id: String(last.id) }));
  return { considered: pages.length, tags };
}

/* ---- a state's inputs moved ----------------------------------------------------------------------------------------- */

interface States { prints: Record<string, string>; active?: { state: string; print: string; done: number; first: boolean } }

/** What moves when a state's files should be cut again: its published entries, the member offices and owner choices beside them, and its place map. One small read each. */
export async function statePrint(facts: Query, state: string): Promise<string> {
  const { keys, translations, memberOffices } = mirrorScopes(state);
  const read: ReadOnlyQuery = statements => Promise.all(statements.map(statement => facts(statement.text, statement.params)));
  const version = await publicationVersion([...keys, ...memberOffices.map(scope => `CURATED_READER_RECORD:${scope}`)], read, translations);
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

/**
 * Copies the state once, cuts its package by division, and lets the copy go. The national shelf is held before the cut, so the cut reads it from
 * memory, and emptied after it: a check made from the copy would find no President, and that must not be what the national file is made from.
 */
async function cutOnce(deps: PlaceFilesDeps, state: string): Promise<Cut> {
  await deps.national();
  const copy = await deps.openMirror(state);
  try {
    return await withStateSeam(copy.seam, () => withPlaceMapReads(async () => {
      const full = await readStatePackage(state);
      const registration = await copiedRegistration(copy, state);
      const [zip] = [...(await readStateZipPlaces(state)).keys()];
      return cutState(full, registration, await readStatePackage(state, [stateDivisionId(state)], zip, { earlyDistricts: true }));
    }));
  } finally { forgetNationalShelf(); await copy.close(); }
}

async function statePass(deps: PlaceFilesDeps, now: number): Promise<{ readonly considered: number; readonly tags: (string | null)[] } | null> {
  const saved = await readPassCursor(deps.facts, STATES_CURSOR);
  const c: States = saved ? JSON.parse(saved) as States : { prints: {} };
  if (!c.active) {
    if (memory.statesCheckedAt && now - memory.statesCheckedAt < STATES_EVERY_MS) return null;
    memory.statesCheckedAt = now;
    const [next] = await dueStates(deps.facts, c.prints);
    if (!next) return null;
    c.active = { ...next, done: 0, first: !(await held(deps, next.state)).pointer };
    memory.pass = undefined;
    deps.log?.(`Place files: ${next.state} is read from a copy of its inputs`);
  }
  const { state, first } = c.active, have = await held(deps, state), own = stateDivisionId(state);
  if (!memory.cut || memory.pass?.state !== state) {
    memory.cut = await cutOnce(deps, state);
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
    if (await file(deps, have, { ...base, share, ...(id === own ? { wide: { ...cut.wide, shared: [...have.shared] } } : {}) }, now)) fresh.push(id);
  }
  pass.done += batch.length;
  const finished = pass.done >= pass.todo.length;
  if (finished) {
    have.zips = await readZipPlaces(state, cut.zipDistricts);
    have.aliases = await stateAliases(deps.facts, state);
  }
  const tags = [fresh.length || finished ? await commit(deps, state, have, finished ? [...have.files.keys()] : fresh) : null];
  if (finished) {
    c.prints[state] = c.active.print; delete c.active; memory.statesCheckedAt = 0; memory.pass = undefined; memory.cut = undefined;
    deps.log?.(`Place files: ${state} is done`);
  } else c.active.done = pass.done;
  await writePassCursor(deps.facts, STATES_CURSOR, JSON.stringify(c));
  return { considered: batch.length, tags };
}

export interface PlaceFilesTurn { readonly considered: number; readonly kind: "pages" | "state" | "idle" }

/** One look: the national file, then a changed saved page, then the next of a state's pass. */
export async function placeFilesTurn(deps: PlaceFilesDeps): Promise<PlaceFilesTurn> {
  const now = (deps.now ?? Date.now)();
  const tags: (string | null)[] = await syncNational(deps, now);
  const pages = await pagesTurn(deps, now);
  tags.push(...pages.tags);
  let turn: PlaceFilesTurn = { considered: pages.considered, kind: pages.considered ? "pages" : "idle" };
  if (!pages.considered) {
    const pass = await statePass(deps, now);
    if (pass) { tags.push(...pass.tags); turn = { considered: pass.considered, kind: "state" }; }
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
      tab.until = start + owedMs(Math.max(0, databaseBytesSpent() - before));
      if (turn?.considered) { total.considered += turn.considered; log(`Place files: ${turn.considered} places looked at (${turn.kind === "pages" ? "saved pages changed" : "from a state's copy"})`); }
      if (!turn || turn.considered) await writePassCursor(facts, TAB_CURSOR, String(tab.until)).catch(() => undefined);
      if (input.turnEnd?.aborted) break;
      await sleep(turn?.considered ? BUSY_PAUSE_MS : IDLE_MS);
    }
  } finally { closePlaceFilesLane(); }
  return total;
}
