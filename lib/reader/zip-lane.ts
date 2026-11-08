import { createHash } from "node:crypto";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { withPlaceMapReads, type PlaceEntry } from "../place-map/reader.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { READER_NATIONAL_CACHE_TAG, purgeReaderCacheTags, readerZipTag, type ReaderCachePurger } from "./cache.ts";
import { publicationVersion } from "./canonical.ts";
import { databaseBytesSpent, owedMsFor, untilEnd } from "./lane-pace.ts";
import { dropHeldPlaceRows } from "./place.ts";
import type { StateMirror } from "./state-mirror.ts";
import { mirrorScopes } from "./state-mirror.ts";
import type { ZipMeetings } from "./zip-answer-build.ts";
import { packZipAnswer, publishNational, readZipAnswer, zipAnswerKey, type ZipAnswer, type ZipStateAnswer } from "./zip-answer.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const ZIP_ANSWERS_JOB = { id: "zip-answers", databaseBytesPerRun: 60_000_000 } as const;
/** What the lane may move an hour, over both databases and everything it does: a state's copy, the saved pages of ZIPs, claiming and finishing. Each look puts the time its bytes take to come due on a tab, kept across the lane's starts; nothing goes while the tab is owed. */
export const ZIP_ANSWER_BYTES_PER_HOUR = 60_000_000;
/** ZIPs read in one look; they are read one after another, so only one is in memory at a time. */
const BATCH = 12;
/** Changed pages named in one range of changes. */
const RANGE_ROWS = 200;
/** With nothing to do the lane looks again this soon, and after a look that wrote it rests this long. */
const IDLE_MS = 10_000, BUSY_PAUSE_MS = 1_000;
/** How often every state's inputs are looked at to see whether any moved, and the national record. */
const STATES_EVERY_MS = 5 * 60_000, NATIONAL_EVERY_MS = 60_000;
const CHANGES_CURSOR = "zips:changes", STATES_CURSOR = "zips:states", TAB_CURSOR = "zips:tab";

export function zipAnswersLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: ZIP_ANSWERS_JOB.id, everyMs: 60_000, budgetMs: 55 * 60_000, run };
}

export const owedMs = (bytes: number): number => owedMsFor(bytes, ZIP_ANSWER_BYTES_PER_HOUR);

/** Everything the lane builds an answer from. The routes' own functions are what the real ones call. */
export interface ZipBuilders {
  /** What the saved pages decide: the ZIP's place, point and the package the meetings answer reads. Null when the ZIP has none. */
  readonly meetings: (zip: string) => Promise<ZipMeetings | null>;
  readonly location: (zip: string) => Promise<Record<string, unknown>>;
  /** The state's answer for the ZIP, read from the state's copy. */
  readonly stateBody: (state: string, zip: string, entry: PlaceEntry, copy: StateMirror) => Promise<ZipStateAnswer>;
  readonly routing: () => Promise<EverydayRoutingProjection | null>;
  /** Copies one state's inputs once. */
  readonly openMirror: (state: string) => Promise<StateMirror>;
}

export interface ZipLaneDeps {
  readonly facts: Query;
  readonly store: ReaderArtifactStore;
  readonly build: ZipBuilders;
  readonly purge?: ReaderCachePurger;
  readonly now?: () => number;
}

const memory = { mirror: undefined as StateMirror | undefined, statesCheckedAt: 0, nationalCheckedAt: 0, tab: { until: 0, loaded: false } };
/** Cache tags written but not yet cleared, kept for the next look when a purge is refused. */
const unpurged = new Set<string>();
/** A part filed under its fingerprint need not be filed again by this process. */
const filed = new Set<string>();

/** For tests, and for the end of a turn: lets go of the state held and forgets what this process knew. */
export async function closeZipLane(forget = false): Promise<void> {
  await memory.mirror?.close().catch(() => undefined);
  memory.mirror = undefined;
  if (forget) { memory.statesCheckedAt = 0; memory.nationalCheckedAt = 0; memory.tab = { until: 0, loaded: false }; unpurged.clear(); filed.clear(); }
}

export interface ZipTurn { readonly considered: number; readonly written: number; readonly kind: "changes" | "state" | "idle" }
const IDLE: ZipTurn = { considered: 0, written: 0, kind: "idle" };

/** Files one answer when it differs from the one published (by print), naming the tag to clear after the look's writes. */
async function file(deps: ZipLaneDeps, answer: ZipAnswer, published: string | undefined, tags: string[]): Promise<void> {
  const packed = packZipAnswer(answer);
  if (packed.print === published) return;
  if (packed.part && !filed.has(packed.part.key)) { await deps.store.writeBytes(packed.part.key, packed.part.bytes); filed.add(packed.part.key); }
  await deps.store.writeBytes(zipAnswerKey(answer.zip), packed.file);
  tags.push(readerZipTag(answer.zip));
}

/** Purge only after every file of the look is written; a refused purge is tried again at the next look. */
async function clear(deps: ZipLaneDeps, tags: readonly string[], log: (line: string) => void): Promise<number> {
  for (const tag of tags) unpurged.add(tag);
  if (unpurged.size) {
    const result = await (deps.purge ?? purgeReaderCacheTags)([...unpurged]);
    if (result.purged) unpurged.clear(); else log(`ZIP answers: the CDN was not cleared (${result.detail ?? "refused"}); it is tried again`);
  }
  return tags.length;
}

/** What the answers hold of the published answer, without its print. */
const withoutPrint = ({ print: _print, ...answer }: ZipAnswer & { readonly print: string }): ZipAnswer => answer;

/** The national record is filed once and pointed to; a change clears every answer that shows it, once. */
async function syncNational(deps: ZipLaneDeps, now: number, log: (line: string) => void): Promise<void> {
  if (memory.nationalCheckedAt && now - memory.nationalCheckedAt < NATIONAL_EVERY_MS) return;
  memory.nationalCheckedAt = now;
  let routing: EverydayRoutingProjection | null;
  try { routing = await deps.build.routing(); }
  catch (error) { log(`ZIP answers: the national routing record could not be read (${error instanceof Error ? error.message : String(error)})`); return; }
  if (await publishNational(deps.store, routing)) {
    log("ZIP answers: the national routing record changed; one file written");
    await clear(deps, [READER_NATIONAL_CACHE_TAG], log);
  }
}

/* ---- a state's answers, from one copy of the state ---------------------------------------------------------------- */

interface States { prints: Record<string, string>; active?: { state: string; print: string; zip: string } }

/** What moves when a state's answers should be read again: its published entries, the member offices and owner choices beside them, and its place map. One small read each. */
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

/** The states whose inputs moved or that have no answers yet, the most populated first. A state with no ZIPs has nothing to read. */
async function dueStates(facts: Query, held: Record<string, string>): Promise<{ state: string; print: string }[]> {
  const rows = await facts(`SELECT state,sum(page_priority) AS weight FROM entity WHERE id ~ '^zip:[0-9]{5}$' GROUP BY state`);
  const weight = new Map(rows.map(row => [String(row.state), Number(row.weight ?? 0)]));
  const due: { state: string; print: string }[] = [];
  for (const state of REGISTRY_STATES) {
    if (!weight.has(state)) continue;
    const print = await statePrint(facts, state);
    if (held[state] !== print) due.push({ state, print });
  }
  return due.sort((a, b) => (weight.get(b.state) ?? 0) - (weight.get(a.state) ?? 0));
}

/** One look of a state's pass: the next ZIPs of the state get its answer from the copy, with the rest of their answer as it was published. */
async function statePass(deps: ZipLaneDeps, now: number, log: (line: string) => void): Promise<{ readonly zips: number; readonly written: number; readonly commit: () => Promise<void> } | null> {
  const saved = await readPassCursor(deps.facts, STATES_CURSOR);
  const c: States = saved ? JSON.parse(saved) as States : { prints: {} };
  const save = () => writePassCursor(deps.facts, STATES_CURSOR, JSON.stringify(c));
  if (!c.active) {
    if (memory.statesCheckedAt && now - memory.statesCheckedAt < STATES_EVERY_MS) return null;
    memory.statesCheckedAt = now;
    const [next] = await dueStates(deps.facts, c.prints);
    if (!next) return null;
    c.active = { ...next, zip: "" };
    log(`ZIP answers: ${next.state} is read from a copy of its inputs`);
  }
  const { state } = c.active;
  if (memory.mirror?.state !== state) { await closeZipLane(); memory.mirror = await deps.build.openMirror(state); }
  const copy = memory.mirror!;
  const zips = (await deps.facts(`SELECT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE e.state=$1::char(2) AND m.zip>$2
    GROUP BY m.zip ORDER BY m.zip LIMIT $3`, [state, c.active.zip, BATCH])).map(row => String(row.zip));
  const tags: string[] = [];
  for (const zip of zips) {
    try {
      const held = await readZipAnswer(zip, deps.store);
      let base: ZipAnswer;
      if (held) base = withoutPrint(held);
      else {
        const meetings = await deps.build.meetings(zip);
        if (!meetings) continue;
        base = { zip, location: await deps.build.location(zip), states: {}, ...meetings };
      }
      if (!base.place.states?.includes(state)) continue;
      const body = await deps.build.stateBody(state, zip, base.place, copy);
      await file(deps, { ...base, states: { ...base.states, [state]: body } }, held?.print, tags);
    } catch (error) { log(`ZIP answers: ${zip} could not be read (${error instanceof Error ? error.message : String(error)}); it keeps its last answer`); }
  }
  // What the look kept of the saved pages (shared by neighbouring ZIPs) is let go before the next look.
  dropHeldPlaceRows();
  const written = await clear(deps, tags, log);
  if (zips.length < BATCH) {
    c.prints[state] = c.active.print; delete c.active; memory.statesCheckedAt = 0;
    await closeZipLane();
    log(`ZIP answers: ${state} is done`);
  } else c.active.zip = zips.at(-1)!;
  return { zips: zips.length, written, commit: save };
}

/* ---- a saved page changed: the meetings part of the ZIPs laid over it ----------------------------------------------- */

interface Mark { readonly at: string; readonly id: string }
/** What the lane has read to in the saved pages, by when they were built, and the range it is working through with the last ZIP it reached. */
interface Changes { pages: Mark; range?: { readonly to: Mark; zip: string } }

const STATE_ROOT = `^ocd-division/country:us/(?:state|territory|district):[a-z]{2}$`;

async function nextChanged(facts: Query, now: number): Promise<{ readonly zips: string[]; readonly commit: () => Promise<void> }> {
  const saved = await readPassCursor(facts, CHANGES_CURSOR);
  const c: Changes = saved ? JSON.parse(saved) as Changes : { pages: { at: new Date(now).toISOString(), id: "" } };
  const save = () => writePassCursor(facts, CHANGES_CURSOR, JSON.stringify(c));
  if (!saved) await save();
  if (!c.range) {
    const pages = await facts(`SELECT place_id AS id,built_at::text AS at FROM place_page WHERE (built_at,place_id)>($1::timestamptz,$2::text) ORDER BY built_at,place_id LIMIT $3`, [c.pages.at, c.pages.id, RANGE_ROWS]);
    if (!pages.length) return { zips: [], commit: async () => {} };
    c.range = { to: { at: String(pages.at(-1)!.at), id: String(pages.at(-1)!.id) }, zip: "" };
  }
  const { range } = c;
  const zips = (await facts(`WITH changed AS (SELECT place_id AS id FROM place_page WHERE (built_at,place_id)>($1::timestamptz,$2::text) AND (built_at,place_id)<=($3::timestamptz,$4::text)),
    places AS (SELECT id FROM changed UNION SELECT place_id FROM entity_place WHERE entity_id IN (SELECT id FROM changed)),
    states AS (SELECT DISTINCT upper(substring(id FROM '([a-z]{2})$')) AS state FROM places WHERE id ~ '${STATE_ROOT}')
    SELECT m.zip FROM zip_place m WHERE m.zip>$5 AND (m.place_id IN (SELECT id FROM places)
      OR m.place_id IN (SELECT e.id FROM entity e WHERE e.kind='place' AND e.state IN (SELECT state FROM states)))
    GROUP BY m.zip ORDER BY m.zip LIMIT $6`, [c.pages.at, c.pages.id, range.to.at, range.to.id, range.zip, BATCH])).map(row => String(row.zip));
  if (zips.length < BATCH) { c.pages = range.to; delete c.range; } else range.zip = zips.at(-1)!;
  return { zips, commit: save };
}

/** The state each ZIP lies in first, so a look works one state at a time. */
async function orderedByState(facts: Query, zips: readonly string[]): Promise<[string, string][]> {
  if (zips.length < 2) return zips.map(zip => [zip, ""]);
  const rows = await facts(`SELECT m.zip,min(e.state) AS state FROM zip_place m JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE m.zip=ANY($1::text[]) GROUP BY m.zip`, [zips]);
  const state = new Map(rows.map(row => [String(row.zip), String(row.state ?? "")]));
  return zips.map((zip): [string, string] => [zip, state.get(zip) ?? ""]).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
}

/** Reads the saved pages again for ZIPs already published; the state answers and the location stay as they are. */
async function meetingsAgain(deps: ZipLaneDeps, zips: readonly string[], log: (line: string) => void): Promise<number> {
  const tags: string[] = [];
  let lastState: string | undefined;
  for (const [zip, state] of await orderedByState(deps.facts, zips)) {
    // Only the state being worked has its saved pages in memory.
    if (lastState !== undefined && state !== lastState) dropHeldPlaceRows();
    lastState = state;
    try {
      const held = await readZipAnswer(zip, deps.store);
      // A ZIP with no answer yet gets all of it when its state is read from a copy.
      if (!held) continue;
      const meetings = await deps.build.meetings(zip);
      if (!meetings) continue;
      await file(deps, { ...withoutPrint(held), ...meetings }, held.print, tags);
    } catch (error) { log(`ZIP answers: ${zip} could not be read (${error instanceof Error ? error.message : String(error)}); it keeps its last answer`); }
  }
  return clear(deps, tags, log);
}

/** One look: a changed saved page first, then the next of a state's pass. */
export async function zipAnswersTurn(deps: ZipLaneDeps & { readonly turnEnd?: AbortSignal; readonly log?: (line: string) => void }): Promise<ZipTurn> {
  const log = deps.log ?? (() => {}), now = (deps.now ?? Date.now)();
  await untilEnd(deps.turnEnd, syncNational(deps, now, log));
  const changed = await untilEnd(deps.turnEnd, nextChanged(deps.facts, now));
  if (changed.zips.length) {
    const written = await untilEnd(deps.turnEnd, meetingsAgain(deps, changed.zips, log));
    await changed.commit();
    return { considered: changed.zips.length, written, kind: "changes" };
  }
  await changed.commit();
  const pass = await untilEnd(deps.turnEnd, withPlaceMapReads(() => statePass(deps, now, log)));
  if (!pass) return IDLE;
  await pass.commit();
  return { considered: pass.zips, written: pass.written, kind: "state" };
}

/** The lane's turn: keeps looking until it is asked to stop, resting while the tab is owed so everything it does stays within its pace. */
export async function runZipAnswersLane(input: { readonly deps: ZipLaneDeps; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly log: (line: string) => void; readonly sleep?: (ms: number) => Promise<void>; readonly clock?: () => number;
  /** Counts as they happen, for the turn's minute line. */ readonly total?: { considered: number; written: number } }): Promise<{ readonly considered: number; readonly written: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { considered: 0, written: 0 };
  const clock = input.clock ?? Date.now, facts = input.deps.facts, tab = memory.tab;
  if (!tab.loaded) { tab.until = Number(await readPassCursor(facts, TAB_CURSOR) ?? 0); tab.loaded = true; }
  try {
    while (!input.stopRequested()) {
      const start = clock();
      if (start < tab.until) { await sleep(Math.min(tab.until - start, IDLE_MS)); continue; }
      const before = databaseBytesSpent();
      let turn: ZipTurn | undefined;
      try { turn = await zipAnswersTurn({ ...input.deps, now: clock, turnEnd: input.turnEnd, log: input.log }); }
      catch (error) {
        // Cursors move only after a look's files are written, so the look is made again.
        if (!input.turnEnd?.aborted) input.log(`ZIP answers: a look failed (${error instanceof Error ? error.message : String(error)}); it is made again`);
      }
      tab.until = start + owedMs(Math.max(0, databaseBytesSpent() - before));
      if (turn) {
        total.considered += turn.considered; total.written += turn.written;
        if (turn.considered) input.log(`ZIP answers: ${turn.considered} ZIPs read (${turn.kind === "changes" ? "saved pages changed" : "from a state's copy"}), ${turn.written} written`);
      }
      if (!turn || turn.considered) await writePassCursor(facts, TAB_CURSOR, String(tab.until)).catch(() => undefined);
      if (input.turnEnd?.aborted) break;
      await sleep(turn?.considered ? BUSY_PAUSE_MS : IDLE_MS);
    }
  } finally { await closeZipLane(); }
  return total;
}
