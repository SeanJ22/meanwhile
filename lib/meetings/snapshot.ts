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
  /**
   * WHICH KIND of nothing (F22, 2026-08-20). Present exactly when `ok` is
   * false. `WALL` — the retrieval did not land, the run continues, and
   * carry-forward keeps this source's rows. `JOB` — our own code broke on a
   * payload we did hold, and the refresh run goes red. Optional because
   * snapshots committed before 2026-08-20 predate the field; a missing value
   * is read as `WALL`, which is what every one of them was.
   */
  failure?: "WALL" | "JOB";
  /**
   * The furthest LADDER RUNG a walled retrieval reached, in `CLAUDE.md`'s
   * numbering — so the next attempt starts at the next rung rather than
   * re-walking the ones already known to fail. Absent when the client cannot
   * say; a missing rung is never filled in with a plausible one.
   */
  walledAtRung?: number;
  /**
   * WHICH LADDER THIS NUMBER IS IN (RULING 17, Prompt C item 8, 2026-08-20).
   *
   * `CANONICAL` means `CLAUDE.md`'s retrieval-mechanics fourteen, which is the
   * only numbered ladder as of 2026-08-20 and is what every value written by
   * this code means. `PRE_F22_LADDER_UNKNOWN` marks a value recorded before
   * F22, when this repo carried TWO numbered ladders — the mechanics fourteen
   * and `docs/source-ladder.md`'s discovery thirteen — and nothing recorded
   * which one a writer meant.
   *
   * A marked value keeps its number and is NEVER reinterpreted: guessing which
   * ladder an old number meant would manufacture a retrieval history nobody
   * walked. Absent means the same as `CANONICAL` for anything this code wrote,
   * and the marker exists so a reader of old data is not told otherwise.
   */
  rungProvenance?: "CANONICAL" | "PRE_F22_LADDER_UNKNOWN";
  fetched: number;
  normalized: number;
  drops: NormalizeDropCounts;
  /**
   * Divisions this source could not reach while otherwise succeeding (g3).
   *
   * A source serving five bodies across three hosts can be refused by one of
   * them, and `ok: false` would smear that refusal across all five. This is
   * the narrow claim, and the meetings route prefers it when attributing a
   * gap to a body on the reader's card.
   */
  unreachableOcdIds?: string[];
  /**
   * How many of this source's meetings in this snapshot came from the
   * PREVIOUS one because this run could not reach them (g3).
   *
   * Never a silent number: a refresh that failed and carried forward looks
   * identical, from the outside, to a refresh that succeeded — unless it
   * says so. The carried rows keep their own `provenance.collectedAt`, so
   * nothing on the reader's card claims a freshness it does not have.
   */
  carriedForward?: number;
}

/**
 * The two numbers this file holds, both stated (hotfix-0817, 2026-08-17).
 *
 * A snapshot after a partial refusal contains rows from two different runs,
 * and until now it stated one number for them. The scheduled refresh has
 * failed twice on exactly that: 193 fetched fresh, 24 carried forward for
 * `schedulepage`, 217 in the file, and an invariant that predated
 * carry-forward asserting 217 === 193. The gate was right and the arithmetic
 * was incomplete — so both numbers are recorded, and they are required to
 * reconcile against each other, against the per-source reports, and against
 * the rows themselves.
 */
export interface SnapshotCounts {
  /**
   * Rows this run actually retrieved and KEPT — the sum of `normalized` less
   * `duplicatesCollapsed`.
   *
   * It was the plain sum until 2026-08-20, when a second route was wired for
   * the Town of Newbury's four boards and the cross-source merge began
   * collapsing sittings two sources both published. A count that ignored the
   * merge would have disagreed with the rows underneath it, which is the
   * stated-N-equals-rendered-rows rule failing in the one file whose job is to
   * reconcile.
   */
  fresh: number;
  /**
   * Rows the cross-source merge collapsed as the same sitting published twice
   * (NH Hunt, 2026-08-20). Stated rather than absorbed: "fewer meetings than
   * the reader would otherwise have seen" is never allowed to be silent, and
   * a merge that quietly ate a real sitting would otherwise look like a source
   * that quietly stopped publishing one.
   *
   * Optional so every snapshot written before the merge existed still reads;
   * absent means zero and means no merge ran.
   */
  duplicatesCollapsed?: number;
  /** Rows carried out of the previous snapshot. Equals the marked rows. */
  carried: number;
  /** `fresh + carried`, and the length of `meetings`. */
  total: number;
}

export interface MeetingsSnapshot {
  formatVersion: 1;
  /** When the refresh that produced this file ran. Rendered to the reader. */
  generatedAt: string;
  /**
   * Fresh, carried, total — stated, not derived (hotfix-0817).
   *
   * Required, deliberately: an optional reconciliation is one a later writer
   * can omit, and the check would then pass by not running. The committed
   * snapshot gained the block in the same commit that made it mandatory, so
   * no refresh ever reads a previous file without one.
   */
  counts: SnapshotCounts;
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
/**
 * Both numbers, and they close — or the snapshot is refused (hotfix-0817, 2026-08-17).
 *
 * The old invariant was `meetings.length === sum(normalized)`. It was correct
 * for every snapshot written before carry-forward existed and wrong for every
 * one written after a partial refusal, which is how the scheduled refresh came
 * to fail twice with `217 !== 193` while the data behind it was right.
 *
 * The repair is NOT a loosened comparison. `total >= claims`, a tolerance, or
 * a skip-when-carried would each make the test pass and make it worthless —
 * a measurement that cannot tell correct from incorrect is not a correctness
 * test. Instead the snapshot states BOTH numbers and four equalities have to
 * hold at once:
 *
 * 1. `fresh + carried === total`, and `total` is the row count.
 * 2. `fresh === sum(normalized)` — the original assertion, preserved exactly,
 *    now pointed at the number it was always about.
 * 3. `carried === ` the number of rows carrying a carry mark, per source as
 *    well as in total. A count that cannot be recounted against its own rows
 *    is the defect this whole change exists to remove.
 * 4. Every marked row names its source and a parseable last-fresh instant.
 *
 * Exported so the write boundary, the read path and `tests/snapshot.test.ts`
 * all use one implementation rather than three that can drift apart.
 */
export function reconcileCounts(snap: MeetingsSnapshot): void {
  const counts = snap.counts;
  if (!counts || typeof counts !== "object") {
    throw new Error("snapshot must state its counts: fresh, carried, total");
  }
  for (const key of ["fresh", "carried", "total"] as const) {
    if (!Number.isInteger(counts[key])) {
      throw new Error(`snapshot count "${key}" must be stated as an integer`);
    }
  }
  if (counts.total !== snap.meetings.length) {
    throw new Error(
      `snapshot states ${counts.total} total meetings but holds ${snap.meetings.length}`,
    );
  }
  if (counts.fresh + counts.carried !== counts.total) {
    throw new Error(
      `snapshot counts do not close: ${counts.fresh} fresh + ${counts.carried} carried !== ${counts.total} total`,
    );
  }

  /*
   * The pair, made to reconcile (the D68 rule). Per-source `normalized` is
   * what each child produced BEFORE the cross-source merge; `fresh` is what
   * survived it. The difference is not slack — it is `duplicatesCollapsed`,
   * and this is the arithmetic that refuses a snapshot where it is not.
   */
  const claimed = snap.sources.reduce((n, s) => n + s.normalized, 0);
  const collapsed = counts.duplicatesCollapsed ?? 0;
  if (!Number.isInteger(collapsed) || collapsed < 0) {
    throw new Error("snapshot states a non-integer duplicatesCollapsed");
  }
  if (counts.fresh + collapsed !== claimed) {
    throw new Error(
      `snapshot states ${counts.fresh} fresh meetings plus ${collapsed} collapsed ` +
        `but sources claim ${claimed}`,
    );
  }

  // The mark, per row: a carried row that cannot say where it came from or
  // when it was last real is a stale row wearing a fresh row's clothes.
  const markedBySource = new Map<string, number>();
  const sourceNames = new Set(snap.sources.map((s) => s.source));
  for (const m of snap.meetings) {
    const carried = m.carried;
    if (!carried) continue;
    if (!carried.source || typeof carried.source !== "string") {
      throw new Error(`carried meeting "${m.id}" does not name the source it came from`);
    }
    if (!sourceNames.has(carried.source)) {
      throw new Error(
        `carried meeting "${m.id}" names source "${carried.source}", which this snapshot does not account for`,
      );
    }
    if (
      typeof carried.lastFreshAt !== "string" ||
      !Number.isFinite(Date.parse(carried.lastFreshAt))
    ) {
      throw new Error(
        `carried meeting "${m.id}" does not state a parseable instant at which it was last fresh`,
      );
    }
    markedBySource.set(carried.source, (markedBySource.get(carried.source) ?? 0) + 1);
  }

  const marked = [...markedBySource.values()].reduce((a, b) => a + b, 0);
  if (counts.carried !== marked) {
    throw new Error(
      `snapshot states ${counts.carried} carried meetings but ${marked} row(s) carry the mark`,
    );
  }
  for (const s of snap.sources) {
    const claimedCarried = s.carriedForward ?? 0;
    const actual = markedBySource.get(s.source) ?? 0;
    if (claimedCarried !== actual) {
      throw new Error(
        `${s.source}: reports ${claimedCarried} meeting(s) carried forward but ${actual} row(s) carry its mark`,
      );
    }
  }
}

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
    // Same rule as the drop counts, applied to the two fields g3 added: a
    // carry-forward that does not state its integer is a refresh claiming
    // freshness it does not have, which is the exact failure the field
    // exists to make visible.
    if (s.carriedForward !== undefined && !Number.isInteger(s.carriedForward)) {
      throw new Error(`${s.source}: carriedForward must be stated as an integer`);
    }
    if (
      s.unreachableOcdIds !== undefined &&
      (!Array.isArray(s.unreachableOcdIds) ||
        s.unreachableOcdIds.some((id) => typeof id !== "string" || !id))
    ) {
      throw new Error(`${s.source}: unreachableOcdIds must be a list of division ids`);
    }
    // A source that reports every one of its divisions unreachable AND
    // reports itself ok is contradicting itself; the adapter is required to
    // throw in that case so the source reads as failed.
    if (s.ok && s.carriedForward !== undefined && s.carriedForward > 0 &&
        (s.unreachableOcdIds?.length ?? 0) === 0) {
      throw new Error(
        `${s.source}: carried ${s.carriedForward} meeting(s) forward while reporting nothing unreachable`,
      );
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
  reconcileCounts(snap);
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
  assertAttributionIsHonest(snap);
}

/**
 * D19's rule, enforced where a file gets written rather than where it gets
 * rendered (g10).
 *
 * "An unresolved heading attributes to NOTHING, never to the host" is a claim
 * about data, and by the time a null reaches a component the lie is already
 * in the file — the same argument the refresh corollary makes about a failed
 * fetch. So the write boundary refuses it:
 *
 * - a row must cite the meeting it belongs to, so the join cannot drift;
 * - an UNRESOLVED row must carry no body and no division. Copying the host's
 *   identifiers onto a segment the agenda said in capital letters was NOT the
 *   host is precisely the misattribution the whole feature exists to prevent;
 * - a RESOLVED row must actually name a body, or it is asserting a match it
 *   does not have;
 * - every row must quote the heading it was read from, so an attribution can
 *   be checked against the published agenda instead of trusted.
 */
function assertAttributionIsHonest(snap: MeetingsSnapshot): void {
  for (const m of snap.meetings) {
    // Absent is not empty, and only absent is skipped: a meeting whose agenda
    // was read and named nobody legitimately carries zero rows.
    if (m.actingBodies === undefined) continue;
    if (!Array.isArray(m.actingBodies)) {
      throw new Error(`meeting ${m.id}: actingBodies must be an array when present`);
    }
    for (const row of m.actingBodies) {
      if (row.meetingId !== m.id) {
        throw new Error(
          `meeting ${m.id} carries an acting-body row citing ${row.meetingId}`,
        );
      }
      if (!row.evidence || typeof row.evidence !== "string") {
        throw new Error(
          `meeting ${m.id}: an acting-body row does not quote the heading it was read from`,
        );
      }
      if (row.attribution === "UNRESOLVED" && (row.bodyId !== null || row.ocdId !== null)) {
        throw new Error(
          `meeting ${m.id}: the unresolved segment "${row.evidence}" was attributed to ` +
            `${row.bodyId ?? row.ocdId} — an unresolved heading attributes to NOTHING, never to the host`,
        );
      }
      if (row.attribution === "RESOLVED" && !row.bodyId) {
        throw new Error(
          `meeting ${m.id}: the segment "${row.evidence}" claims RESOLVED and names no body`,
        );
      }
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

/**
 * What the whole snapshot holds that the run behind it did not retrieve (hotfix-0817).
 *
 * The footer states one age for the file. That age is true of the fresh rows
 * and false of the carried ones, so the footer needs the count and, where the
 * carried rows agree on a single last-fresh day, that day — stated in the
 * footer rather than left for a reader to discover by opening a card.
 */
export interface SnapshotCarriedMeta {
  /** How many rows in the whole snapshot came from an earlier run. */
  count: number;
  /**
   * The instant those rows were last fresh — non-null ONLY when every carried
   * row agrees on the same calendar day, and then it is the OLDEST of them.
   *
   * Null when the days disagree, and the surface then says each row carries
   * its own date instead of naming one: across days no single date can stand
   * for the set without overstating some row's freshness.
   *
   * Within a day the rows differ by the seconds one refresh took to walk a
   * source's pages, and the OLDEST is the only choice that never claims a row
   * is fresher than it is. The walk check at 03255 caught the first version
   * taking the FIRST row's instant, which named a stamp newer than 24 of the
   * 25 rows it was speaking for — the same defect this whole section exists
   * for, one layer smaller.
   */
  lastFreshAt: string | null;
}

/** What the client is told about the snapshot behind its answer. */
export interface SnapshotClientMeta {
  generatedAt: string;
  /** Present only when the snapshot actually holds carried rows. */
  carried?: SnapshotCarriedMeta;
  sources: Array<{
    source: string;
    ok: boolean;
    error: string | null;
    /** The narrow refusal, so the route attributes the gap to these bodies only. */
    unreachableOcdIds?: string[];
    /** How many of this source's rows came from the previous snapshot. */
    carriedForward?: number;
  }>;
}

export function snapshotClientMeta(snapshot: MeetingsSnapshot): SnapshotClientMeta {
  const stamps = snapshot.meetings.flatMap((m) =>
    m.carried ? [m.carried.lastFreshAt] : [],
  );
  const days = new Set(stamps.map((iso) => iso.slice(0, 10)));
  return {
    generatedAt: snapshot.generatedAt,
    ...(stamps.length > 0
      ? {
          carried: {
            count: stamps.length,
            // One day, one date — the OLDEST of them, the only one that never
            // claims a row is fresher than it is. Across days no date can
            // stand for the set, so the surface says so instead.
            lastFreshAt:
              days.size === 1
                ? stamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
                : null,
          },
        }
      : {}),
    sources: snapshot.sources.map(
      ({ source, ok, error, unreachableOcdIds, carriedForward }) => ({
        source,
        ok,
        error,
        ...(unreachableOcdIds?.length ? { unreachableOcdIds } : {}),
        ...(carriedForward !== undefined ? { carriedForward } : {}),
      }),
    ),
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
