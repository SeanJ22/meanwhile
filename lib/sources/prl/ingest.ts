import { parseCsv, normalizeProfiles, sourceBioguides } from "./index.ts";
import { createPrimaryAggregator, normalizeStateProfiles } from "./precompute.ts";
import { parsePrlInstant, isNewerThanMark } from "./future-date.ts";
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
 * The ingestion engine: download, filter, land, mark.
 *
 * Large files stream; their raw rows partition into bounded object-storage
 * objects and only rows newer than the mark are written. Small profile files
 * are read whole and precomputed. The receipt's high-water mark is capped at
 * now. The object store, clock, source bytes and prior receipt are injected.
 *
 * @freshness-reads-here — the receipt's `fetchedAt` is stamped from the run's
 * injected `now`; it is the retrieval instant this ingestion records.
 */

const DEFAULT_ROWS_PER_OBJECT = 100_000;

export interface PrlSourceOpen {
  readonly textChunks: TextChunks;
  readonly sourceSha256: string;
  readonly finalUrl: string;
  readonly member: string;
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

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(",");
}
function sanitizeTag(value: string): string {
  return value.replace(/[^0-9A-Za-z_-]/g, "-");
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
  if (options.dataset.target === "profile") return ingestProfile(options);
  if (options.dataset.target === "archive") return ingestArchive(options);
  throw new Error(`PRL_INGEST_UNSUPPORTED_TARGET:${options.dataset.id}:${options.dataset.target}`);
}

async function ingestArchive(options: IngestOptions): Promise<PrlIngestReceipt> {
  const { dataset, archive, now, priorReceipt } = options;
  if (!archive) throw new Error(`PRL: ${dataset.id} is an archive dataset but no object store was provided`);
  const rowsPerObject = options.rowsPerObject ?? DEFAULT_ROWS_PER_OBJECT;
  const source = await options.open();
  const priorMark = priorReceipt?.highWaterMark ?? null;
  const ext = dataset.format === "json-zip" ? "json" : "csv";
  const runTag = priorMark === null ? "initial" : `delta-${sanitizeTag(new Date(now).toISOString())}`;
  const tracker = newTracker(priorMark);
  const primary = dataset.id === "primary-rhetoric" ? createPrimaryAggregator() : null;

  let rowsSeen = 0;
  let rowsWritten = 0;
  let partIndex = 0;
  const newObjectKeys: string[] = [];
  let buffer: string[] = [];
  let headerLine = "";

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const key = `${dataset.id}/${runTag}/part-${String(partIndex).padStart(5, "0")}.${ext}`;
    const body = ext === "json"
      ? `[\n${buffer.join(",\n")}\n]\n`
      : `${headerLine}\n${buffer.join("\n")}\n`;
    await archive.put(key, new TextEncoder().encode(body), ext === "json" ? "application/json" : "text/csv");
    newObjectKeys.push(key);
    partIndex += 1;
    buffer = [];
  };

  if (dataset.format === "json-zip") {
    const dateField = dataset.dateField ?? "date";
    const cursorField = dataset.cursorField ?? "date";
    for await (const value of streamJsonArrayObjects(source.textChunks)) {
      rowsSeen += 1;
      const object = (value ?? {}) as Record<string, unknown>;
      const cursorRaw = String(object[cursorField] ?? "");
      const dateRaw = String(object[dateField] ?? "");
      observe(tracker, cursorRaw, dateRaw, now);
      if (isNewerThanMark(cursorRaw, priorMark)) {
        buffer.push(JSON.stringify(object));
        rowsWritten += 1;
        if (buffer.length >= rowsPerObject) await flush();
      }
    }
  } else {
    let header: string[] | null = null;
    let cursorIdx = -1;
    let dateIdx = -1;
    for await (const row of streamCsvRecords(source.textChunks)) {
      if (header === null) {
        header = row;
        headerLine = csvRow(row);
        cursorIdx = header.indexOf(dataset.cursorField ?? "date");
        dateIdx = header.indexOf(dataset.dateField ?? "date");
        if (cursorIdx < 0) {
          throw new Error(`PRL: ${dataset.id} data file has no cursor column "${dataset.cursorField}" — the schema moved; a wrong cutoff would silently miss corrections.`);
        }
        continue;
      }
      rowsSeen += 1;
      const cursorRaw = row[cursorIdx] ?? "";
      const dateRaw = dateIdx >= 0 ? (row[dateIdx] ?? "") : "";
      observe(tracker, cursorRaw, dateRaw, now);
      if (primary) primary.add(recordFromRow(header, row));
      if (isNewerThanMark(cursorRaw, priorMark)) {
        buffer.push(csvRow(row));
        rowsWritten += 1;
        if (buffer.length >= rowsPerObject) await flush();
      }
    }
    if (header === null) throw new Error(`PRL: ${dataset.id} data file parsed to zero rows`);
  }
  await flush();

  const measuredAt = tracker.dateMaxRaw ?? new Date(now).toISOString().slice(0, 10);
  const primaryResult = primary ? primary.result(measuredAt) : null;
  const objectKeys = [...(priorReceipt?.objectKeys ?? []), ...newObjectKeys];

  return buildReceipt({
    dataset,
    source,
    now,
    priorMark,
    tracker,
    rowsSeen,
    rowsWritten,
    objectStore: archive.kind,
    objectKeys,
    newObjectKeys,
    profileKind: primaryResult ? "primary" : null,
    profiles: primaryResult ? primaryResult.profiles : null,
  });
}

async function ingestProfile(options: IngestOptions): Promise<PrlIngestReceipt> {
  const { dataset, now } = options;
  const source = await options.open();
  let text = "";
  for await (const chunk of source.textChunks) text += chunk;
  const nowDate = new Date(now).toISOString().slice(0, 10);

  let profileKind: PrlProfileKind;
  let profiles: readonly unknown[];
  let rowsSeen: number;
  let measuredAt = nowDate;

  if (dataset.id === "profiles-current") {
    const result = normalizeProfiles(text, sourceBioguides(text));
    profileKind = "federal";
    profiles = result.profiles;
    rowsSeen = result.counts.rowsInFile;
    measuredAt = result.profiles.map((profile) => profile.measuredAt).sort().at(-1) ?? nowDate;
  } else if (dataset.id === "profiles-state") {
    const result = normalizeStateProfiles(parseCsv(text), nowDate);
    profileKind = "state";
    profiles = result.profiles;
    rowsSeen = result.counts.rowsInFile;
  } else {
    throw new Error(`PRL: ${dataset.id} is not a known profile dataset`);
  }

  const tracker = newTracker(null);
  // Aggregate profiles recompute whole; the "coverage through" is the measure
  // date, capped at now, and there is no per-row cursor to advance.
  const cappedMeasuredAt = parsePrlInstant(measuredAt) !== null && parsePrlInstant(measuredAt)! <= now ? measuredAt : nowDate;
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
    datasetId: dataset.id,
    scope,
    title: dataset.title,
    target: dataset.target,
    sourceUrl: dataset.url,
    sourceSha256: input.source.sourceSha256,
    member: input.source.member || null,
    cursorField: dataset.cursorField,
    fetchedAt: new Date(input.now).toISOString(),
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
