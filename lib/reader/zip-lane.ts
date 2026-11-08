import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { purgeReaderCacheTags, readerCacheScopeForPublication, readerZipTag, type ReaderCachePurger } from "./cache.ts";
import { databaseBytesSpent, owedMsFor, untilEnd } from "./lane-pace.ts";
import { dropHeldPlaceRows } from "./place.ts";
import { packZipAnswer, zipAnswerKey, type ZipAnswer } from "./zip-answer.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const ZIP_ANSWERS_JOB = { id: "zip-answers", databaseBytesPerRun: 60_000_000 } as const;
/** What the lane may move an hour, over both databases and everything it does: changes, first answers, the daily check, claiming and finishing. Each look puts the time its bytes take to come due on a tab, kept across the lane's starts; nothing goes while the tab is owed. */
export const ZIP_ANSWER_BYTES_PER_HOUR = 60_000_000;
/** ZIPs rebuilt in one look; they are read one after another, so only one is in memory at a time. */
const BATCH = 8;
/** Changed pages (or publications) named in one range of changes. */
const RANGE_ROWS = 200;
/** ZIP groups looked through in one go when their ZIPs already have answers. */
const PRIORITY_LOOKS = 40, PRIORITY_ZIPS = 100;
/** With nothing to do the lane looks again this soon, and after a look that wrote it rests this long. */
const IDLE_MS = 10_000, BUSY_PAUSE_MS = 1_000;
/** Every ZIP's answer is read again and compared this often. */
export const SWEEP_EVERY_MS = 24 * 60 * 60_000;
const CHANGES_CURSOR = "zips:changes", BACKFILL_CURSOR = "zips:backfill", SWEEP_CURSOR = "zips:sweep", TAB_CURSOR = "zips:tab";

export function zipAnswersLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: ZIP_ANSWERS_JOB.id, everyMs: 60_000, budgetMs: 55 * 60_000, run };
}

export const owedMs = (bytes: number): number => owedMsFor(bytes, ZIP_ANSWER_BYTES_PER_HOUR);

/** Which ZIPs hold a published answer and with what print: one small file per three-digit ZIP prefix, kept beside the answers. */
class ZipIndex {
  private readonly shards = new Map<string, { value: Record<string, string>; etag: string | null; dirty: boolean }>();
  constructor(private readonly store: ReaderArtifactStore) {}
  private static key = (zip: string) => `reader/zip-index/${zip.slice(0, 3)}.json`;
  private async shard(zip: string) {
    const key = ZipIndex.key(zip);
    let held = this.shards.get(key);
    if (!held) {
      const read = await this.store.readJsonPointer<Record<string, string>>(key);
      this.shards.set(key, held = { value: read?.value ?? {}, etag: read?.etag ?? null, dirty: false });
    }
    return held;
  }
  async print(zip: string): Promise<string | undefined> { return (await this.shard(zip)).value[zip]; }
  async record(zip: string, print: string): Promise<void> { const held = await this.shard(zip); held.value[zip] = print; held.dirty = true; }
  /** Writes the shards that changed. A shard someone else wrote meanwhile is read again and given these prints. */
  async flush(): Promise<void> {
    for (const [key, held] of this.shards) {
      if (!held.dirty) continue;
      for (let attempt = 0; ; attempt++) {
        const result = await this.store.writeJsonPointer(key, held.value, held.etag);
        if (result.modified) { held.etag = result.etag; held.dirty = false; break; }
        if (attempt >= 3) throw new Error("ZIP_INDEX_BUSY");
        const current = await this.store.readJsonPointer<Record<string, string>>(key);
        held.value = { ...current?.value, ...held.value }; held.etag = current?.etag ?? null;
      }
    }
    // A shard is read again when next needed, so a long turn never holds the whole country's index.
    this.shards.clear();
  }
}

export interface ZipLaneDeps {
  readonly facts: Query;
  readonly store: ReaderArtifactStore;
  /** Builds a ZIP's answer by the functions the routes call; null when the ZIP has none to give. */
  readonly build: (zip: string) => Promise<ZipAnswer | null>;
  readonly purge?: ReaderCachePurger;
  readonly now?: () => number;
}

/** Cache tags written but not yet cleared, kept for the next look when a purge is refused. */
const unpurged = new Set<string>();
/** A part filed under its fingerprint need not be filed again by this process. */
const filed = new Set<string>();

export interface ZipTurn { readonly considered: number; readonly written: number; readonly kind: "changes" | "first" | "check" | "idle" }
const IDLE: ZipTurn = { considered: 0, written: 0, kind: "idle" };

/** Builds each ZIP, files it only when its print differs from the one published, and clears the CDN's copies after the writes. */
async function publish(deps: ZipLaneDeps, zips: readonly string[], log: (line: string) => void): Promise<number> {
  const index = new ZipIndex(deps.store), tags: string[] = [];
  let lastState: string | undefined;
  for (const [zip, state] of await orderedByState(deps.facts, zips)) {
    // Only the state being worked has its saved pages in memory.
    if (lastState !== undefined && state !== lastState) dropHeldPlaceRows();
    lastState = state;
    let answer: ZipAnswer | null;
    try { answer = await deps.build(zip); }
    catch (error) { log(`ZIP answers: ${zip} could not be read (${error instanceof Error ? error.message : String(error)}); it keeps its last answer`); continue; }
    if (!answer) continue;
    const packed = packZipAnswer(answer);
    if (await index.print(zip) === packed.print) continue;
    if (packed.part && !filed.has(packed.part.key)) { await deps.store.writeBytes(packed.part.key, packed.part.bytes); filed.add(packed.part.key); }
    await deps.store.writeBytes(zipAnswerKey(zip), packed.file);
    await index.record(zip, packed.print);
    tags.push(readerZipTag(zip));
  }
  await index.flush();
  // Purge only now, after every file of this look is written; a refused purge is tried again at the next look.
  for (const tag of tags) unpurged.add(tag);
  if (unpurged.size) {
    const result = await (deps.purge ?? purgeReaderCacheTags)([...unpurged]);
    if (result.purged) unpurged.clear(); else log(`ZIP answers: the CDN was not cleared (${result.detail ?? "refused"}); it is tried again`);
  }
  return tags.length;
}

/** The state each ZIP lies in first, so a look works one state at a time. */
async function orderedByState(facts: Query, zips: readonly string[]): Promise<[string, string][]> {
  if (zips.length < 2) return zips.map(zip => [zip, ""]);
  const rows = await facts(`SELECT m.zip,min(e.state) AS state FROM zip_place m JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE m.zip=ANY($1::text[]) GROUP BY m.zip`, [zips]);
  const state = new Map(rows.map(row => [String(row.zip), String(row.state ?? "")]));
  return zips.map((zip): [string, string] => [zip, state.get(zip) ?? ""]).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
}

/* ---- ZIPs whose answer changed ------------------------------------------------------------------------------------ */

interface Mark { readonly at: string; readonly id: string }
/** Where the lane has read to in what changed: saved pages by when they were built, publications by when they were promoted; and the range it is working through, with the last ZIP it reached. */
interface Changes { pages: Mark; promos: Mark; range?: { readonly kind: "pages" | "promos"; readonly to: Mark; zip: string } }

const STATE_ROOT = `^ocd-division/country:us/(?:state|territory|district):[a-z]{2}$`;

/** The states a promoted publication changes the ZIP answers of. A meeting calendar reaches readers through its saved place pages. */
function statesOfPromotion(row: Record<string, unknown>): readonly string[] {
  const recordClass = String(row.record_class), scope = String(row.scope);
  if (recordClass === "MEETING") return [];
  if (recordClass === "CURATED_READER_RECORD" && scope === requiredManualProductionContract("everyday-routing").scope) return REGISTRY_STATES;
  return readerCacheScopeForPublication(scope, { recordClass }).states ?? [];
}

async function nextChanged(facts: Query, now: number): Promise<{ readonly zips: string[]; readonly commit: () => Promise<void> }> {
  const saved = await readPassCursor(facts, CHANGES_CURSOR);
  const start = new Date(now).toISOString();
  const c: Changes = saved ? JSON.parse(saved) as Changes : { pages: { at: start, id: "" }, promos: { at: start, id: "" } };
  const save = () => writePassCursor(facts, CHANGES_CURSOR, JSON.stringify(c));
  if (!saved) await save();
  if (!c.range) {
    const pages = await facts(`SELECT place_id AS id,built_at::text AS at FROM place_page WHERE (built_at,place_id)>($1::timestamptz,$2::text) ORDER BY built_at,place_id LIMIT $3`, [c.pages.at, c.pages.id, RANGE_ROWS]);
    const promos = pages.length ? [] : await facts(`SELECT key AS id,promoted_at::text AS at FROM civic_data_promotions WHERE (promoted_at,key)>($1::timestamptz,$2::text) ORDER BY promoted_at,key LIMIT $3`, [c.promos.at, c.promos.id, RANGE_ROWS]);
    const rows = pages.length ? pages : promos;
    if (!rows.length) return { zips: [], commit: async () => {} };
    c.range = { kind: pages.length ? "pages" : "promos", to: { at: String(rows.at(-1)!.at), id: String(rows.at(-1)!.id) }, zip: "" };
  }
  const range = c.range, from = c[range.kind];
  let zips: string[];
  if (range.kind === "pages") {
    zips = (await facts(`WITH changed AS (SELECT place_id AS id FROM place_page WHERE (built_at,place_id)>($1::timestamptz,$2::text) AND (built_at,place_id)<=($3::timestamptz,$4::text)),
      places AS (SELECT id FROM changed UNION SELECT place_id FROM entity_place WHERE entity_id IN (SELECT id FROM changed)),
      states AS (SELECT DISTINCT upper(substring(id FROM '([a-z]{2})$')) AS state FROM places WHERE id ~ '${STATE_ROOT}')
      SELECT m.zip FROM zip_place m WHERE m.zip>$5 AND (m.place_id IN (SELECT id FROM places)
        OR m.place_id IN (SELECT e.id FROM entity e WHERE e.kind='place' AND e.state IN (SELECT state FROM states)))
      GROUP BY m.zip ORDER BY m.zip LIMIT $6`, [from.at, from.id, range.to.at, range.to.id, range.zip, BATCH])).map(row => String(row.zip));
  } else {
    const rows = await facts(`SELECT record_class,scope FROM civic_data_promotions WHERE (promoted_at,key)>($1::timestamptz,$2::text) AND (promoted_at,key)<=($3::timestamptz,$4::text)`,
      [from.at, from.id, range.to.at, range.to.id]);
    const states = [...new Set(rows.flatMap(statesOfPromotion))];
    zips = !states.length ? [] : (await facts(`SELECT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE e.state=ANY($1::char(2)[]) AND m.zip>$2
      GROUP BY m.zip ORDER BY m.zip LIMIT $3`, [states, range.zip, BATCH])).map(row => String(row.zip));
  }
  if (zips.length < BATCH) { c[range.kind] = range.to; delete c.range; } else range.zip = zips.at(-1)!;
  return { zips, commit: save };
}

/* ---- ZIPs never published, busiest first ------------------------------------------------------------------------- */

interface Backfill { after?: readonly [number, string]; doneAt?: string }

async function nextUnpublished(facts: Query, store: ReaderArtifactStore): Promise<{ readonly zips: string[]; readonly commit: () => Promise<void> }> {
  const held = JSON.parse(await readPassCursor(facts, BACKFILL_CURSOR) ?? "{}") as Backfill;
  if (held.doneAt) return { zips: [], commit: async () => {} };
  const index = new ZipIndex(store);
  let after = held.after, zips: string[] = [], finished = false;
  for (let look = 0; look < PRIORITY_LOOKS && zips.length < BATCH && !finished; look++) {
    const rows = await facts(`SELECT substring(id FROM 5) AS zip,page_priority FROM entity WHERE id ~ '^zip:[0-9]{5}$' AND page_priority>0 AND (page_priority,id)<($1::int,$2::text)
      ORDER BY page_priority DESC,id DESC LIMIT $3`, [after?.[0] ?? 2_147_483_647, after ? `zip:${after[1]}` : "", PRIORITY_ZIPS]);
    if (!rows.length) { finished = true; break; }
    for (const row of rows) {
      const zip = String(row.zip);
      after = [Number(row.page_priority), zip];
      if (await index.print(zip) === undefined) zips.push(zip);
      if (zips.length >= BATCH) break;
    }
  }
  const cursor: Backfill = finished ? { doneAt: new Date().toISOString() } : { after };
  return { zips, commit: () => writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(cursor)) };
}

/* ---- every ZIP, about once a day --------------------------------------------------------------------------------- */

interface Sweep { zip: string; startedAt: string; doneAt?: string }

async function nextChecked(facts: Query, now: number): Promise<{ readonly zips: string[]; readonly commit: () => Promise<void> }> {
  const saved = await readPassCursor(facts, SWEEP_CURSOR);
  let sweep: Sweep = saved ? JSON.parse(saved) as Sweep : { zip: "", startedAt: new Date(now).toISOString() };
  if (sweep.doneAt) {
    if (now - Date.parse(sweep.startedAt) < SWEEP_EVERY_MS) return { zips: [], commit: async () => {} };
    sweep = { zip: "", startedAt: new Date(now).toISOString() };
  }
  const zips = (await facts(`SELECT zip FROM zip_place WHERE zip>$1 GROUP BY zip ORDER BY zip LIMIT $2`, [sweep.zip, BATCH])).map(row => String(row.zip));
  const next: Sweep = zips.length < BATCH ? { ...sweep, zip: zips.at(-1) ?? sweep.zip, doneAt: new Date(now).toISOString() } : { ...sweep, zip: zips.at(-1)! };
  return { zips, commit: () => writePassCursor(facts, SWEEP_CURSOR, JSON.stringify(next)) };
}

/** One look: ZIPs whose answer changed first, then ZIPs never published from the busiest down, then the next ZIPs of the daily check. */
export async function zipAnswersTurn(deps: ZipLaneDeps & { readonly turnEnd?: AbortSignal; readonly log?: (line: string) => void }): Promise<ZipTurn> {
  const log = deps.log ?? (() => {}), now = (deps.now ?? Date.now)();
  const order = [["changes", () => nextChanged(deps.facts, now)], ["first", () => nextUnpublished(deps.facts, deps.store)], ["check", () => nextChecked(deps.facts, now)]] as const;
  for (const [kind, next] of order) {
    const { zips, commit } = await untilEnd(deps.turnEnd, next());
    if (!zips.length) { await commit(); continue; }
    const written = await untilEnd(deps.turnEnd, publish(deps, zips, log));
    await commit();
    return { considered: zips.length, written, kind };
  }
  return IDLE;
}

const tab = { until: 0, loaded: false };

/** The lane's turn: keeps looking until it is asked to stop, resting while the tab is owed so everything it does stays within its pace. */
export async function runZipAnswersLane(input: { readonly deps: ZipLaneDeps; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly log: (line: string) => void; readonly sleep?: (ms: number) => Promise<void>; readonly clock?: () => number;
  /** Counts as they happen, for the turn's minute line. */ readonly total?: { considered: number; written: number } }): Promise<{ readonly considered: number; readonly written: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { considered: 0, written: 0 };
  const clock = input.clock ?? Date.now, facts = input.deps.facts;
  if (!tab.loaded) { tab.until = Number(await readPassCursor(facts, TAB_CURSOR) ?? 0); tab.loaded = true; }
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
      if (turn.considered) input.log(`ZIP answers: ${turn.considered} ZIPs read (${turn.kind === "changes" ? "changed" : turn.kind === "first" ? "first answers" : "daily check"}), ${turn.written} written`);
    }
    if (!turn || turn.considered) await writePassCursor(facts, TAB_CURSOR, String(tab.until)).catch(() => undefined);
    if (input.turnEnd?.aborted) break;
    await sleep(turn?.considered ? BUSY_PAUSE_MS : IDLE_MS);
  }
  return total;
}

/** For tests: lets a fresh process-state start from nothing. */
export function resetZipLaneMemory(): void { tab.until = 0; tab.loaded = false; unpurged.clear(); filed.clear(); }
