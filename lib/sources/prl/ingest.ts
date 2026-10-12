import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, normalizeProfiles, sourceBioguides } from "./index.ts";
import { createPrimaryAggregator, normalizeStateProfiles } from "./precompute.ts";
import { isVisibleAsOf, parsePrlInstant } from "./future-date.ts";
import {
  recordFromRow,
  streamCsvRecords,
  streamJsonArrayObjects,
  type TextChunks,
} from "./streaming.ts";
import type { PrlArchiveStore } from "./archive-store.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";
import type { PrlDataset } from "./inventory.ts";
import type { PrlIngestReceipt, PrlProfileKind } from "./receipt.ts";

/**
 * Complete changed releases stream through a bounded disk index into immutable
 * person partitions. Same-date and late records are included; dates describe
 * coverage and never suppress records. Unchanged validated source hashes reuse
 * their prior normalized release and retain the source's retrieval date.
 *
 * @freshness-reads-here — the receipt's `fetchedAt` is stamped from the run's
 * injected `now`; it is the retrieval instant this ingestion records.
 */

const DEFAULT_ROWS_PER_OBJECT = 10_000;
export const PRL_INGEST_PARSER_VERSION = "prl-ingest/2";
export const prlSubjectShard = (subject: string) => createHash("sha256").update(subject).digest("hex");

export interface PrlSourceOpen {
  readonly failedSourceCheck?: import("../known-release.ts").FailedSourceCheck;
  readonly textChunks: TextChunks;
  readonly sourceSha256: string;
  readonly finalUrl: string;
  readonly member: string;
  readonly retrievedAt?: string;
  readonly byteLength?: number;
  readonly unchanged?: boolean;
  readonly accept?: () => Promise<void>;
  readonly dispose?: () => Promise<void>;
}

export interface IngestOptions {
  readonly dataset: PrlDataset;
  /** Required for archive datasets; unused (and omitted) for profile datasets. */
  readonly archive?: PrlArchiveStore;
  readonly now: number;
  readonly priorReceipt: PrlIngestReceipt | null;
  readonly open: () => Promise<PrlSourceOpen>;
  readonly rowsPerObject?: number;
}

interface WatermarkTracker {
  markRaw: string | null;
  markMs: number | null;
  dateMinRaw: string | null;
  dateMinMs: number | null;
  dateMaxRaw: string | null;
  dateMaxMs: number | null;
  rowsAfterNow: number;
  unparseableCursor: number;
}

function newTracker(priorMark: string | null): WatermarkTracker {
  return {
    markRaw: priorMark,
    markMs: parsePrlInstant(priorMark),
    dateMinRaw: null,
    dateMinMs: null,
    dateMaxRaw: null,
    dateMaxMs: null,
    rowsAfterNow: 0,
    unparseableCursor: 0,
  };
}

/** Fold one row's cursor and date into the running watermark, capped at now. */
function observe(tracker: WatermarkTracker, cursorRaw: string, dateRaw: string, nowMs: number): void {
  const cursorMs = parsePrlInstant(cursorRaw);
  if (cursorMs === null) tracker.unparseableCursor += 1;
  else if (cursorMs <= nowMs && (tracker.markMs === null || cursorMs > tracker.markMs)) {
    tracker.markMs = cursorMs;
    tracker.markRaw = cursorRaw.trim();
  }
  const dateMs = parsePrlInstant(dateRaw);
  if (dateMs !== null) {
    if (dateMs > nowMs) tracker.rowsAfterNow += 1;
    else {
      if (tracker.dateMinMs === null || dateMs < tracker.dateMinMs) { tracker.dateMinMs = dateMs; tracker.dateMinRaw = dateRaw.trim(); }
      if (tracker.dateMaxMs === null || dateMs > tracker.dateMaxMs) { tracker.dateMaxMs = dateMs; tracker.dateMaxRaw = dateRaw.trim(); }
    }
  }
}

export async function ingestDataset(options: IngestOptions): Promise<PrlIngestReceipt> {
  const source = await options.open();
  try {
    if (source.unchanged && options.priorReceipt?.parserVersion === PRL_INGEST_PARSER_VERSION &&
        options.priorReceipt.sourceSha256 === source.sourceSha256) {
      return { ...options.priorReceipt, failedSourceCheck: source.failedSourceCheck, rowsWritten: 0, newObjectKeys: [] };
    }
    const opened = { ...options, open: async () => source };
    const receipt = options.dataset.target === "profile" ? await ingestProfile(opened)
      : options.dataset.target === "archive" ? await ingestArchive(opened)
      : (() => { throw new Error(`PRL_INGEST_UNSUPPORTED_TARGET:${options.dataset.id}:${options.dataset.target}`); })();
    await source.accept?.();
    return receipt;
  } finally { await source.dispose?.(); }
}

async function ingestArchive(options: IngestOptions): Promise<PrlIngestReceipt> {
  const { dataset, archive, now, priorReceipt } = options;
  if (!archive) throw new Error(`PRL: ${dataset.id} requires an archive store`);
  const source = await options.open();
  const tracker = newTracker(null), primary = dataset.id === "primary-rhetoric" ? createPrimaryAggregator() : null;
  const root = await mkdtemp(join(tmpdir(), "prl-rows-"));
  // Temporary source processing index, discarded after the immutable objects are complete.
  // Cache stays bounded; publication and reader state remain in the existing civic data plane.
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => {
    exec(sql: string): void; close(): void; prepare(sql: string): {
      run(...values: (string | number)[]): void;
      iterate(...values: (string | number)[]): Iterable<Record<string, string>>;
      get(...values: (string | number)[]): Record<string, string> | undefined;
    } } };
  const db = new DatabaseSync(join(root, "rows.sqlite"));
  db.exec("PRAGMA journal_mode=OFF; PRAGMA cache_size=-8192; CREATE TABLE records(subject TEXT, id TEXT, modified TEXT, body TEXT, PRIMARY KEY(subject,id)) WITHOUT ROWID; BEGIN");
  const insert = db.prepare("INSERT INTO records VALUES(?,?,?,?)"), existing = db.prepare("SELECT modified,body FROM records WHERE subject=? AND id=?"),
    replace = db.prepare("UPDATE records SET modified=?,body=? WHERE subject=? AND id=?");
  let rowsSeen = 0, subjectCount = 0, storedRows = 0;
  const objectRoot = `${dataset.id}/${source.sourceSha256}/${PRL_INGEST_PARSER_VERSION.replace("/", "-")}`;
  const put = async (object: Record<string, unknown>) => {
    rowsSeen++;
    observe(tracker, String(object[dataset.cursorField ?? "date"] ?? ""), String(object[dataset.dateField ?? "date"] ?? ""), now);
    const subject = dataset.key ? String(object[dataset.key] ?? "") : "";
    const row = JSON.stringify(Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right))));
    const native = object.id ?? object.source_id ?? object.tweet_id;
    const id = native === undefined ? createHash("sha256").update(row).digest("hex") :
      `${String(object.source ?? "")}:${String(native)}:${object.id !== undefined ? "" : createHash("sha256").update(String(object.text ?? "")).digest("hex")}`;
    const modified = String(object.last_updated ?? object.date ?? "");
    try { insert.run(subject, id, modified, row); }
    catch (error) {
      const prior = existing.get(subject, id);
      if (!prior) throw error;
      if (prior.body !== row) {
        const before = parsePrlInstant(prior.modified), after = parsePrlInstant(modified);
        if (before === null || after === null || before === after) throw new Error("PRL_NATIVE_RECORD_CONFLICT");
        if (after > before) replace.run(modified, row, subject, id);
      }
    }
    if (rowsSeen % 10_000 === 0) db.exec("COMMIT; BEGIN");
  };
  try {
  if (dataset.format === "json-zip") {
    for await (const value of streamJsonArrayObjects(source.textChunks)) await put(value as Record<string, unknown>);
  } else {
    let header: string[] | null = null;
    for await (const row of streamCsvRecords(source.textChunks)) {
      if (header === null) {
        header = row;
        if (!dataset.key || !header.includes(dataset.key) || !header.includes(dataset.cursorField ?? "date")) throw new Error("PRL_SOURCE_SCHEMA_CHANGED");
        continue;
      }
      if (row.length !== header.length) throw new Error("PRL_CSV_COLUMN_COUNT_INVALID");
      await put(recordFromRow(header, row));
    }
    if (!header) throw new Error("PRL_CSV_EMPTY");
  }
  if (!rowsSeen) throw new Error("PRL_ARCHIVE_EMPTY");
  db.exec("COMMIT");
  // Visit one native person at a time. Readers fetch only this person's small index and bounded parts.
  for (const { subject } of db.prepare("SELECT DISTINCT subject FROM records ORDER BY subject").iterate()) {
    const keys: string[] = [];
    let buffer: string[] = [], bytes = 0;
    const flush = async () => {
      if (!buffer.length) return;
      const body = new TextEncoder().encode(`[${buffer.join(",")}]`), digest = createHash("sha256").update(body).digest("hex");
      const key = `${objectRoot}/people/${prlSubjectShard(subject)}/${digest}.json`;
      if (!(await archive.head(key))) await archive.put(key, body, "application/json");
      keys.push(key); buffer = []; bytes = 0;
    };
    for (const { body } of db.prepare("SELECT body FROM records WHERE subject=? ORDER BY modified DESC,id").iterate(subject)) {
      storedRows++;
      if (primary) {
        const row = JSON.parse(body) as Record<string, unknown>;
        if (isVisibleAsOf(String(row.date ?? ""), now)) primary.add(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])));
      }
      buffer.push(body); bytes += Buffer.byteLength(body);
      if (buffer.length >= (options.rowsPerObject ?? DEFAULT_ROWS_PER_OBJECT) || bytes >= 1024 * 1024) await flush();
    }
    await flush();
    await archive.put(`${objectRoot}/people/${prlSubjectShard(subject)}/index.json`,
      new TextEncoder().encode(JSON.stringify({ subject, keys })), "application/json");
    subjectCount++;
  }
  const result = primary?.result(tracker.dateMaxRaw ?? "");
  return { ...buildReceipt({ dataset, source, now, priorMark: priorReceipt?.highWaterMark ?? null, tracker,
    rowsSeen, rowsWritten: storedRows, objectStore: archive.kind, objectKeys: [], newObjectKeys: [],
    profileKind: result ? "primary" : null, profiles: result?.profiles ?? null }), objectRoot, subjectCount };
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }

}

async function ingestProfile(options: IngestOptions): Promise<PrlIngestReceipt> {
  const { dataset, now } = options;
  const source = await options.open();
  let text = "";
  for await (const chunk of source.textChunks) {
    text += chunk;
    if (text.length > 32 * 1024 * 1024) throw new Error("PRL_PROFILE_TOO_LARGE");
  }
  // Completion and column shape are verified even though the small profile normalizer uses a whole CSV.
  let width: number | null = null;
  for await (const row of streamCsvRecords((async function* () { yield text; })())) {
    if (width === null) width = row.length;
    else if (row.length !== width) throw new Error("PRL_CSV_COLUMN_COUNT_INVALID");
  }
  let profileKind: PrlProfileKind;
  let profiles: readonly unknown[];
  let rowsSeen: number;
  let measuredAt: string | null = null;

  if (dataset.id === "profiles-current" || dataset.id === "profiles-national") {
    const result = normalizeProfiles(text, sourceBioguides(text));
    profileKind = "federal";
    profiles = result.profiles;
    rowsSeen = result.counts.rowsInFile;
    measuredAt = result.profiles.map((profile) => profile.measuredAt).sort().at(-1) ?? null;
  } else if (dataset.id === "profiles-state") {
    const result = normalizeStateProfiles(parseCsv(text), null);
    profileKind = "state";
    profiles = result.profiles;
    rowsSeen = result.counts.rowsInFile;
  } else {
    throw new Error(`PRL: ${dataset.id} is not a known profile dataset`);
  }

  const tracker = newTracker(null);
  // Aggregate profiles recompute whole; the "coverage through" is the measure
  // date, capped at now, and there is no per-row cursor to advance.
  const cappedMeasuredAt = parsePrlInstant(measuredAt) !== null && parsePrlInstant(measuredAt)! <= now ? measuredAt : null;
  tracker.dateMaxRaw = cappedMeasuredAt;

  return buildReceipt({
    dataset,
    source,
    now,
    priorMark: null,
    tracker,
    rowsSeen,
    rowsWritten: profiles.length,
    objectStore: "none",
    objectKeys: [],
    newObjectKeys: [],
    profileKind,
    profiles,
  });
}

interface BuildReceiptInput {
  readonly dataset: PrlDataset;
  readonly source: PrlSourceOpen;
  readonly now: number;
  readonly priorMark: string | null;
  readonly tracker: WatermarkTracker;
  readonly rowsSeen: number;
  readonly rowsWritten: number;
  readonly objectStore: PrlIngestReceipt["objectStore"];
  readonly objectKeys: readonly string[];
  readonly newObjectKeys: readonly string[];
  readonly profileKind: PrlProfileKind | null;
  readonly profiles: readonly unknown[] | null;
}

function buildReceipt(input: BuildReceiptInput): PrlIngestReceipt {
  const { dataset, tracker } = input;
  const scope = dataset.scope ?? dataset.id;
  const highWaterMark = dataset.cursorField === null ? null : tracker.markRaw;
  return {
    formatVersion: 1,
    parserVersion: PRL_INGEST_PARSER_VERSION,
    sourceBytes: input.source.byteLength,
    failedSourceCheck: input.source.failedSourceCheck,
    datasetId: dataset.id,
    scope,
    title: dataset.title,
    target: dataset.target,
    sourceUrl: dataset.url,
    sourceFinalUrl: input.source.finalUrl,
    sourceSha256: input.source.sourceSha256,
    member: input.source.member || null,
    cursorField: dataset.cursorField,
    fetchedAt: input.source.retrievedAt ?? new Date(input.now).toISOString(),
    highWaterMark,
    previousMark: input.priorMark,
    rowsSeen: input.rowsSeen,
    rowsWritten: input.rowsWritten,
    rowsAfterNow: tracker.rowsAfterNow,
    rowsUnparseableCursor: tracker.unparseableCursor,
    coverageFrom: tracker.dateMinRaw,
    coverageThrough: tracker.dateMaxRaw,
    objectStore: input.objectStore,
    objectKeys: input.objectKeys,
    newObjectKeys: input.newObjectKeys,
    profileKind: input.profileKind,
    profiles: input.profiles,
    attribution: PRL_RHETORIC_ATTRIBUTION,
  };
}
