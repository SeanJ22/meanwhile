import { readFileSync, statSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AgendaDocument } from "./agenda-documents.ts";
import type { Meeting, NormalizeDropCounts } from "../sources/types.ts";

/**
 * The committed meetings snapshot — the production data path.
 *
 * The composite fans out to five vendor portals live, which is fine on a
 * developer's machine and wrong in production twice over: a serverless
 * function times out around ten seconds and five serialized portal fetches
 * exceed it under normal conditions, and a fetch per visitor against a public
 * body's portal is exactly the service degradation `CLAUDE.md`'s retrieval
 * discipline forbids. So `pnpm ingest composite` runs the fan-out once,
 * writes what came back to a committed file, and the app reads the file.
 *
 * Committed, not generated at build: the build stays deterministic and never
 * depends on a vendor being reachable, a changed agenda shows up in a diff,
 * and a failed refresh leaves the last good snapshot in place — the site
 * serves stale-but-honest data and *says* how stale (`generatedAt` renders as
 * "last checked").
 *
 * **This module is the only place that knows the file path.** Everything else
 * goes through `readSnapshot()`/`writeSnapshot()`, so moving the snapshot to
 * a database or object store — which is what four zips becoming 90,000
 * governments requires, same limit `docs/state.md` records for the committed
 * GeoJSON — changes this file and nothing else.
 */

export interface SnapshotSourceReport {
  source: string;
  ok: boolean;
  /** Why the source contributed nothing, when it didn't. */
  error: string | null;
  fetched: number;
  normalized: number;
  drops: NormalizeDropCounts;
}

export interface MeetingsSnapshot {
  formatVersion: 1;
  /** When the refresh that produced this file ran. Rendered to the reader. */
  generatedAt: string;
  /** Per-source accounting — the same numbers the ingest gate prints. */
  sources: SnapshotSourceReport[];
  meetings: Meeting[];
  /** Retrieved agenda documents, append-only across refreshes. */
  agendaDocuments: AgendaDocument[];
}

const SNAPSHOT_RELATIVE = join("data", "meetings-snapshot.json");

function snapshotPath(root: string = process.cwd()): string {
  return join(root, SNAPSHOT_RELATIVE);
}

const DROP_KEYS: Array<keyof NormalizeDropCounts> = [
  "placeless",
  "unknownVenue",
  "unplaceableInTime",
  "notConfigured",
];

/**
 * The count invariant, enforced at the write boundary.
 *
 * An operation that can return nothing must be asked what it returned —
 * Vail's NovusAgenda portal returned 200 with zero meetings and was recorded
 * as a HIT, the fourth sighting of that shape. A snapshot whose sources do
 * not each state their fetched/normalized counts, or which claims success
 * with no source succeeding, is refused rather than written.
 */
export function validateSnapshot(value: unknown): asserts value is MeetingsSnapshot {
  const snap = value as MeetingsSnapshot;
  if (!snap || typeof snap !== "object") throw new Error("snapshot is not an object");
  if (snap.formatVersion !== 1) {
    throw new Error(`unknown snapshot formatVersion ${String(snap.formatVersion)}`);
  }
  if (!Number.isFinite(Date.parse(snap.generatedAt))) {
    throw new Error(`generatedAt is not a parseable instant: ${snap.generatedAt}`);
  }
  if (!Array.isArray(snap.sources) || snap.sources.length === 0) {
    throw new Error("snapshot must account for at least one source");
  }
  for (const s of snap.sources) {
    if (!s.source || typeof s.source !== "string") {
      throw new Error("a source report is missing its source name");
    }
    if (typeof s.ok !== "boolean") throw new Error(`${s.source}: ok must be boolean`);
    if (!s.ok && (typeof s.error !== "string" || s.error.length === 0)) {
      throw new Error(`${s.source}: a failed source must state why`);
    }
    if (!Number.isInteger(s.fetched) || !Number.isInteger(s.normalized)) {
      throw new Error(`${s.source}: fetched/normalized counts must be stated as integers`);
    }
    for (const key of DROP_KEYS) {
      if (!Number.isInteger(s.drops?.[key])) {
        throw new Error(`${s.source}: drop count "${key}" must be stated as an integer`);
      }
    }
  }
  if (!snap.sources.some((s) => s.ok)) {
    throw new Error(
      "every source failed — refusing to write a snapshot that would blank the map; keep the previous one",
    );
  }
  if (!Array.isArray(snap.meetings)) throw new Error("meetings must be an array");
  const sourceNames = new Set(snap.sources.map((s) => s.source));
  for (const m of snap.meetings) {
    const namespace = m.id?.split(":")[0];
    if (!namespace || !sourceNames.has(namespace)) {
      throw new Error(
        `meeting id "${m.id}" is not namespaced under any accounted source`,
      );
    }
  }
  if (!Array.isArray(snap.agendaDocuments)) {
    throw new Error("agendaDocuments must be an array");
  }
  const meetingIds = new Set(snap.meetings.map((m) => m.id));
  for (const doc of snap.agendaDocuments) {
    if (!meetingIds.has(doc.meetingId)) {
      throw new Error(
        `agenda document ${doc.id} cites meeting ${doc.meetingId}, which is not in the snapshot`,
      );
    }
  }
}

interface CachedRead {
  path: string;
  mtimeMs: number;
  snapshot: MeetingsSnapshot;
}

let cached: CachedRead | null = null;

/**
 * The committed snapshot, or null when none exists (a fresh clone before the
 * first ingest). Cached per process, invalidated by file mtime so a dev
 * re-running the ingest sees the new data without a server restart.
 *
 * A file that exists but does not validate *throws* — a corrupt snapshot
 * silently treated as absent would blank the map while reporting nothing,
 * which is the raster-basemap failure shape all over again.
 */
export function readSnapshot(root?: string): MeetingsSnapshot | null {
  const path = snapshotPath(root);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) {
    return cached.snapshot;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  validateSnapshot(parsed);
  cached = { path, mtimeMs, snapshot: parsed };
  return parsed;
}

/**
 * Validate and write. Refuses invalid snapshots (see `validateSnapshot`);
 * writes via a temp file and rename so a crash mid-write can never leave a
 * half-written file where the last good snapshot used to be.
 */
export function writeSnapshot(snapshot: MeetingsSnapshot, root?: string): string {
  validateSnapshot(snapshot);
  const path = snapshotPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 1) + "\n", "utf8");
  renameSync(tmp, path);
  cached = null;
  return path;
}

/** What the client is told about the snapshot behind its answer. */
export interface SnapshotClientMeta {
  generatedAt: string;
  sources: Array<{ source: string; ok: boolean; error: string | null }>;
}

export function snapshotClientMeta(snapshot: MeetingsSnapshot): SnapshotClientMeta {
  return {
    generatedAt: snapshot.generatedAt,
    sources: snapshot.sources.map(({ source, ok, error }) => ({ source, ok, error })),
  };
}

/**
 * What to tell the client about the data's age and completeness — non-null
 * only when the snapshot is the active source. A stale snapshot rendering as
 * though it were current is the silent-fallback failure this project has
 * recorded twice; this is the metadata that keeps it loud.
 *
 * Lives here rather than in the meeting registry because this module is
 * server-only (node:fs) and the registry sits on the client-reachable graph.
 */
export function getActiveSnapshotMeta(): SnapshotClientMeta | null {
  const name = process.env.WTP_MEETING_SOURCE?.trim() || "snapshot";
  if (name !== "snapshot") return null;
  try {
    const snapshot = readSnapshot();
    return snapshot ? snapshotClientMeta(snapshot) : null;
  } catch {
    // The route degrades to no freshness line rather than failing the search;
    // the snapshot source itself will throw loudly if it cannot serve.
    return null;
  }
}
