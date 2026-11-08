import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { purgeReaderCacheTags, readerZipTag, type ReaderCachePurger } from "./cache.ts";
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
  private readonly store: ReaderArtifactStore;
  constructor(store: ReaderArtifactStore) { this.store = store; }
  private async shard(zip: string) {
    const key = `reader/zip-index/${zip.slice(0, 3)}.json`;
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
/** What the lane has read to in what changed: saved pages by when they were built; the publication counts the database keeps by state; the states still to be laid over their ZIPs; and the range of pages it is working through, with the last ZIP it reached. */
interface Changes {
  pages: Mark;
  counts: { ready: boolean; since: string | null; seen: Record<string, number> };
  states: string[];
  stateZip: string;
  range?: { readonly to: Mark; zip: string };
}

const STATE_ROOT = `^ocd-division/country:us/(?:state|territory|district):[a-z]{2}$`;
/** The hourly count of sets published, by state and kind. A state-wide kind that moved changes that state's ZIP answers; a calendar reaches readers through its saved pages and a national set through the daily check. */
const PUBLISHED_SQL = `SELECT state,hour::text AS hour,step,n FROM count_hour WHERE step LIKE 'v1:%"published sets", "in"]' AND state<>'US'
  AND hour>=coalesce($1::timestamptz,date_trunc('hour',now())-interval '1 hour')`;

/** The states in which a kind of set other than a calendar was published since the counts were last read. */
async function publishedStates(facts: Query, counts: Changes["counts"]): Promise<string[]> {
  const rows = await facts(PUBLISHED_SQL, [counts.since]);
  const baseline = !counts.ready, changed = new Set<string>();
  counts.ready = true;
  for (const row of rows) {
    const key = `${row.state}|${row.step}|${row.hour}`, n = Number(row.n);
    if (!baseline && (counts.seen[key] ?? 0) < n && (JSON.parse(String(row.step).slice(3)) as string[])[0] !== "MEETING") changed.add(String(row.state));
    counts.seen[key] = n;
  }
  const latest = rows.reduce((hour, row) => String(row.hour) > hour ? String(row.hour) : hour, counts.since ?? "");
  if (latest) {
    counts.since = latest;
    for (const key of Object.keys(counts.seen)) if (key.split("|").at(-1)! < latest) delete counts.seen[key];
  }
  return [...changed].sort();
}

async function nextChanged(facts: Query, now: number): Promise<{ readonly zips: string[]; readonly commit: () => Promise<void> }> {
  const saved = await readPassCursor(facts, CHANGES_CURSOR);
  const start = new Date(now).toISOString();
  const c: Changes = saved ? JSON.parse(saved) as Changes : { pages: { at: start, id: "" }, counts: { ready: false, since: null, seen: {} }, states: [], stateZip: "" };
  const save = () => writePassCursor(facts, CHANGES_CURSOR, JSON.stringify(c));
  if (!saved) { await publishedStates(facts, c.counts); await save(); }
  if (!c.range && !c.states.length) {
    const pages = await facts(`SELECT place_id AS id,built_at::text AS at FROM place_page WHERE (built_at,place_id)>($1::timestamptz,$2::text) ORDER BY built_at,place_id LIMIT $3`, [c.pages.at, c.pages.id, RANGE_ROWS]);
    if (pages.length) c.range = { to: { at: String(pages.at(-1)!.at), id: String(pages.at(-1)!.id) }, zip: "" };
    else { c.states = await publishedStates(facts, c.counts); c.stateZip = ""; if (!c.states.length) return { zips: [], commit: save }; }
  }
  let zips: string[];
  if (c.range) {
    const { range } = c;
    zips = (await facts(`WITH changed AS (SELECT place_id AS id FROM place_page WHERE (built_at,place_id)>($1::timestamptz,$2::text) AND (built_at,place_id)<=($3::timestamptz,$4::text)),
      places AS (SELECT id FROM changed UNION SELECT place_id FROM entity_place WHERE entity_id IN (SELECT id FROM changed)),
      states AS (SELECT DISTINCT upper(substring(id FROM '([a-z]{2})$')) AS state FROM places WHERE id ~ '${STATE_ROOT}')
      SELECT m.zip FROM zip_place m WHERE m.zip>$5 AND (m.place_id IN (SELECT id FROM places)
        OR m.place_id IN (SELECT e.id FROM entity e WHERE e.kind='place' AND e.state IN (SELECT state FROM states)))
      GROUP BY m.zip ORDER BY m.zip LIMIT $6`, [c.pages.at, c.pages.id, range.to.at, range.to.id, range.zip, BATCH])).map(row => String(row.zip));
    if (zips.length < BATCH) { c.pages = range.to; delete c.range; } else range.zip = zips.at(-1)!;
  } else {
    zips = (await facts(`SELECT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id AND e.kind='place' WHERE e.state=$1::char(2) AND m.zip>$2
      GROUP BY m.zip ORDER BY m.zip LIMIT $3`, [c.states[0], c.stateZip, BATCH])).map(row => String(row.zip));
    if (zips.length < BATCH) { c.states.shift(); c.stateZip = ""; } else c.stateZip = zips.at(-1)!;
  }
  return { zips, commit: save };
}

/* ---- ZIPs never published, busiest first ------------------------------------------------------------------------- */

interface Backfill { after?: readonly [number, string]; doneAt?: string }

async function nextUnpublished(facts: Query, store: ReaderArtifactStore): Promise<{ readonly zips: string[]; readonly commit: () => Promise<void> }> {
  const held = JSON.parse(await readPassCursor(facts, BACKFILL_CURSOR) ?? "{}") as Backfill;
  if (held.doneAt) return { zips: [], commit: async () => {} };
  const index = new ZipIndex(store);
  let after = held.after, finished = false;
  const zips: string[] = [];
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
