import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { canonicalAgendaDocument, type AgendaDocument } from "./agenda-documents.ts";
import type { Meeting, NormalizeDropCounts } from "../sources/types.ts";
import type { SourceAcquisitionEvidence } from "../sources/acquisition-trace.ts";
import {
  CivicDataStoreUnavailableError,
  mayUseTestFixture,
  readPinnedPromotedCivicDataBatch,
  readPromotedCivicDataBatch,
  readPromotedCivicData,
  type CivicDataPinnedReadStore,
  type CivicDataReadMetadata,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { activeReaderProofMeetingPin } from "./proof-pin.ts";
import { meetingPartitionFreshnessMs } from "../civic-data/contracts.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  type MeetingPartitionContract,
} from "../civic-data/meeting-partitions.ts";
import { collapseDuplicateSittings } from "../sources/composite/index.ts";

export const MEETINGS_RECORD_CLASS = "MEETING" as const;
/** Reader composition scope; no canonical pointer is ever written at this key. */
export const MEETINGS_SCOPE = "source-wiring-partitions";
export const MEETINGS_SOURCE_ID = "meetings-public-bodies";
/** Observation-only fields excluded when research projections compare civic facts. */
export const MEETINGS_SNAPSHOT_STAMPS = {
  stampKeys: ["generatedAt", "collectedAt", "verifiedAt", "retrievedAt", "lastFreshAt"],
  ignoreTopLevel: ["counts", "sources"],
} as const;

/**
 * The bundled meetings snapshot — a first-canonical bootstrap fixture.
 *
 * The composite fans out to five vendor portals live, which is fine on a
 * developer's machine and wrong in production twice over: a serverless
 * function times out around ten seconds and five serialized portal fetches
 * exceed it under normal conditions, and a fetch per visitor against a public
 * body's portal is exactly the service degradation `CLAUDE.md`'s retrieval
 * discipline forbids. The standing routine-data runner therefore performs
 * the fan-out once and promotes one validated durable projection.
 *
 * This committed file remains only to bootstrap a new, answered-but-empty
 * store. It is never selected after a store read error: not knowing whether a
 * canonical pointer exists is not evidence that it does not exist.
 *
 * `readSnapshot()` remains the explicit read-only bootstrap boundary. The
 * production module exports no repository writer; deterministic round-trip
 * tests use a guarded test-only helper. Runtime consumers go through
 * `readMeetingsProjection()` instead.
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
  /** Exact acquired bodies and observed final redirects for durable promotion proof. */
  acquisitions?: readonly SourceAcquisitionEvidence[];
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
/**
 * Assemble `counts` FROM THE ROWS THAT WILL BE WRITTEN. (NJ Hunt 3 item 1b,
 * 2026-08-22.)
 *
 * `scripts/ingest.ts` built this object inline, and the four numbers were read
 * off three different arrays — one of which, `served`, is the array from BEFORE
 * the second duplicate-collapse pass. `total` came off `served` while
 * `meetings` was written from `finalRows`. They are equal on every run where
 * that pass drops nothing, so it read correct for months. Refresh #43 was the
 * first run where carry-forward put duplicates back, six rows collapsed, and
 * `reconcileCounts` refused the snapshot on `states 461 total meetings but
 * holds 455`. The refusal was right; the arithmetic in front of it was not.
 *
 * So the assembly takes ONE array — the rows going into the file — and derives
 * every count that can be derived from it. `total` and `fresh` can no longer be
 * measured against a different array than `meetings`, because there is no other
 * array in scope. `reconcileCounts` still checks all four equalities
 * independently; this does not replace it, and a helper that made the check
 * pass by construction would be worthless. What it removes is the one degree of
 * freedom that let a correct check be handed wrong inputs.
 */
export function snapshotCounts(
  rows: readonly Meeting[],
  duplicatesCollapsed: number,
): SnapshotCounts {
  const carried = rows.filter((m) => m.carried).length;
  return {
    fresh: rows.length - carried,
    duplicatesCollapsed,
    carried,
    total: rows.length,
  };
}

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
  for (const source of new Set(snap.sources.map(({ source }) => source))) {
    const reports = snap.sources.filter((row) => row.source === source);
    const claimedCarried = reports.reduce((sum, row) => sum + (row.carriedForward ?? 0), 0);
    const actual = markedBySource.get(source) ?? 0;
    if (claimedCarried !== actual) {
      throw new Error(
        `${source}: reports ${claimedCarried} meeting(s) carried forward but ${actual} row(s) carry its mark`,
      );
    }
    const unexplainedClaims = reports
      .filter((row) => row.ok && (row.unreachableOcdIds?.length ?? 0) === 0)
      .reduce((sum, row) => sum + (row.carriedForward ?? 0), 0);
    const unexplainedRows = snap.meetings.filter((meeting) =>
      meeting.carried?.source === source && meeting.carried.reason === "UNEXPLAINED_DISAPPEARANCE"
    ).length;
    if (unexplainedClaims !== unexplainedRows) {
      throw new Error(
        `${source}: reports ${unexplainedClaims} successful-response carry row(s) but ${unexplainedRows} row(s) name UNEXPLAINED_DISAPPEARANCE`,
      );
    }
  }
}

export function validateSnapshot(
  value: unknown,
  options: { readonly allowAllSourcesFailedForDurableTransfer?: boolean } = {},
): asserts value is MeetingsSnapshot {
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
    // Successful-but-thin responses can retain an unexplained prior row, but
    // reconcileCounts requires every such row to carry that exact reason.
  }
  if (!snap.sources.some((s) => s.ok)) {
    const exactCarriedLkg = options.allowAllSourcesFailedForDurableTransfer === true &&
      Array.isArray(snap.meetings) && snap.meetings.length > 0 &&
      snap.counts?.fresh === 0 &&
      snap.counts.carried === snap.counts.total &&
      snap.counts.total === snap.meetings.length;
    if (!exactCarriedLkg) {
      throw new Error(
        "every source failed — refusing any shape except an explicit nonempty all-carried durable LKG",
      );
    }
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
    if (doc.text?.includes("\u0000") || /^(?:PK\u0003\u0004|%PDF-)/.test(doc.text ?? "")) {
      throw new Error(
        `agenda document ${doc.id} contains binary bytes in its Reader text; retain its URL/hash and mark extraction failed`,
      );
    }
  }
  assertBodyIdentityIsPresent(snap);
  assertAttributionIsHonest(snap);
}

/**
 * **AN OLD-SCHEMA SNAPSHOT MAY NOT BECOME CURRENT SERVING STATE.**
 * (2026-08-27.)
 *
 * `Meeting.bodyId` is what stopped 364 of 460 meetings rendering on bodies that
 * did not hold them. Before it existed, a meeting took its body from its
 * GEOGRAPHY, and the snapshot written the day before carried no such field.
 *
 * That created a hazard with no code in it: this file was formerly regenerated
 * and committed by a scheduled job, and it remains a bootstrap fixture that
 * can arrive from an older ref. Nothing about that looks wrong. It parses. It
 * validates. It has meetings in it. It simply attributes them to the wrong
 * governments, silently, and the misattribution class comes back whole.
 *
 * A session resolved exactly that conflict by hand on 2026-08-27, in favour of
 * the branch's snapshot. **A safety property that depends on a future merge
 * being judged correctly is not a safety property.** So the invariant is
 * mechanical and it is asserted by `validateSnapshot`, which both the
 * bootstrap reader and the production candidate path call: a snapshot whose meetings do not carry body
 * identity fails LOUDLY here rather than serving.
 *
 * Deliberately NOT keyed to the conflicting commit, and deliberately not a
 * `formatVersion` bump: the shape is the rule. A file that has the fields is
 * fine whatever produced it, and a file that lacks them is refused whatever
 * version it claims.
 */
function assertBodyIdentityIsPresent(snap: MeetingsSnapshot): void {
  const missing = snap.meetings.filter((m) => !m.bodyId);
  if (missing.length === 0) return;
  const sample = missing
    .slice(0, 3)
    .map((m) => `${m.id} (${m.bodyName ?? "no body name"})`)
    .join(", ");
  throw new Error(
    `${missing.length} of ${snap.meetings.length} meetings carry no bodyId — for example ${sample}. ` +
      "A snapshot without body identity predates Meeting.bodyId, and every meeting in it would " +
      "take its body from its GEOGRAPHY: that is the defect that put 364 of 460 meetings on " +
      "bodies which did not hold them. Re-run `pnpm ingest composite` to regenerate it rather " +
      "than serving this file.",
  );
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
const validatedProjectionValues = new WeakSet<object>();

/**
 * The bundled bootstrap fixture, or null when none exists. Cached per process,
 * invalidated by file mtime so an explicit manual fixture refresh is visible
 * without a process restart.
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
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { agendaDocuments?: unknown }).agendaDocuments)
  ) {
    (parsed as { agendaDocuments: AgendaDocument[] }).agendaDocuments =
      (parsed as { agendaDocuments: AgendaDocument[] }).agendaDocuments.map(canonicalAgendaDocument);
  }
  validateSnapshot(parsed);
  validatedProjectionValues.add(parsed);
  cached = { path, mtimeMs, snapshot: parsed };
  return parsed;
}

export interface MeetingsProjectionReadOptions extends PromotedCivicDataReadOptions {
  /** Fixture root injection for deterministic bootstrap tests. */
  readonly root?: string;
  /** Explicit non-production escape hatch; never converts a failed DB read. */
  readonly allowUnconfiguredBootstrap?: boolean;
}

export interface MeetingPartitionReadback {
  readonly contractId: string;
  readonly source: string;
  readonly bodyId: string;
  readonly scope: string;
  readonly kind: CivicDataReadResult<MeetingsSnapshot>["kind"];
  readonly versionId: string | null;
  readonly detail: string | null;
}

export type MeetingsProjectionReadResult =
  | {
      readonly kind: "PROMOTED";
      readonly value: MeetingsSnapshot;
      readonly metadata: CivicDataReadMetadata;
      readonly partitions: readonly MeetingPartitionReadback[];
      readonly detail: string;
    }
  | Extract<CivicDataReadResult<MeetingsSnapshot>, { readonly kind: "BOOTSTRAP" | "NOT_RECORDED" | "STORE_UNREACHABLE" }>;

/**
 * Read and prove one exact source/body pointer. Standing writers use this
 * narrow boundary for carry-forward; they never open sibling pointers or the
 * aggregate Reader composition.
 */
export async function readMeetingPartitionProjection(
  partition: MeetingPartitionContract,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<MeetingsSnapshot>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedCivicData<MeetingsSnapshot>(MEETINGS_RECORD_CLASS, partition.scope, {
    ...(options.store ? { store: options.store } : {}),
    now,
    maxAgeMs: options.maxAgeMs ?? meetingPartitionFreshnessMs(now),
    bypassCache: options.bypassCache,
  });
  return validateMeetingPartitionProjection(partition, result);
}

function validateMeetingPartitionProjection(
  partition: MeetingPartitionContract,
  result: CivicDataReadResult<MeetingsSnapshot>,
): CivicDataReadResult<MeetingsSnapshot> {
  if (result.kind !== "PROMOTED") return result;
  try {
    if (!validatedProjectionValues.has(result.value)) {
      // A durable partition may consist entirely of explicitly carried rows
      // from one failed route. The write door still refuses a failed live
      // acquisition; the Reader must nevertheless serve that already-proved
      // LKG instead of mistaking its honest outage envelope for blank data.
      validateSnapshot(result.value, {
        allowAllSourcesFailedForDurableTransfer: true,
      });
      validatedProjectionValues.add(result.value);
    }
    if (result.value.sources.length !== 1 || result.value.sources[0]?.source !== partition.meetingSource) {
      throw new Error(`MEETING_PARTITION_SOURCE_MISMATCH:${partition.id}`);
    }
    for (const meeting of result.value.meetings) {
      if (meeting.bodyId !== partition.bodyId || !meeting.id.startsWith(`${partition.meetingSource}:`)) {
        throw new Error(`MEETING_PARTITION_ROW_SCOPE_MISMATCH:${partition.id}:${meeting.id}`);
      }
    }
    return result;
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: result.metadata,
      code: "PROMOTION_PROOF_INVALID",
      detail: error instanceof Error ? error.message : `MEETING_PARTITION_PAYLOAD_INVALID:${partition.id}`,
    };
  }
}

function latestSourceInstant(snapshot: MeetingsSnapshot): string {
  return snapshot.meetings
    .flatMap((meeting) => [
      meeting.carried?.lastFreshAt,
      meeting.provenance?.collectedAt,
    ])
    .filter(
      (value): value is string =>
        typeof value === "string" && Number.isFinite(Date.parse(value)),
    )
    .sort()
    .at(-1) ?? snapshot.generatedAt;
}

/**
 * Read the typed canonical meetings projection. The bundled file is selected
 * only after the store has answered that no pointer exists. A configured
 * store error always remains `STORE_UNREACHABLE`.
 */
export async function readMeetingsProjection(
  options: MeetingsProjectionReadOptions = {},
): Promise<MeetingsProjectionReadResult> {
  const now = options.now ?? new Date().toISOString();
  const allowUnconfiguredBootstrap =
    process.env.NODE_ENV !== "production" &&
    (options.allowUnconfiguredBootstrap ?? mayUseTestFixture());
  const readOptions = {
    ...(options.store ? { store: options.store } : {}),
    now,
    maxAgeMs: options.maxAgeMs ?? meetingPartitionFreshnessMs(now),
    bypassCache: options.bypassCache,
  };
  // Proof-only (lib/meetings/proof-pin.ts): null in every deployed build and
  // outside the Reader proof harness, which leaves this read exactly as it was.
  const pin = activeReaderProofMeetingPin();
  const partitionResults = pin === null
    ? await readPromotedCivicDataBatch<MeetingsSnapshot>(
        MEETINGS_RECORD_CLASS,
        MEETING_PARTITION_CONTRACTS.map((partition) => partition.scope),
        readOptions,
      )
    : await readPinnedPromotedCivicDataBatch<MeetingsSnapshot>(
        MEETINGS_RECORD_CLASS,
        pin.partitions.map(({ scope, versionId }) => ({ scope, versionId })),
        {
          now: readOptions.now,
          maxAgeMs: readOptions.maxAgeMs,
          bypassCache: readOptions.bypassCache,
          ...(options.store ? { store: options.store as CivicDataPinnedReadStore } : {}),
        },
      );
  const reads = MEETING_PARTITION_CONTRACTS.map((partition, index) => ({
    partition,
    result: validateMeetingPartitionProjection(partition, partitionResults[index]!),
  }));
  const rawPromoted = reads.filter((row): row is typeof row & { result: Extract<CivicDataReadResult<MeetingsSnapshot>, { kind: "PROMOTED" }> } => row.result.kind === "PROMOTED");
  const invalid = new Map(
    reads.flatMap(({ partition, result }) =>
      result.kind === "STORE_UNREACHABLE" && result.code === "PROMOTION_PROOF_INVALID"
        ? [[partition.id, result.detail] as const]
        : [],
    ),
  );

  // A duplicate id across authority partitions is ambiguous evidence. Reject
  // every partition claiming that id, not whichever happened to be iterated
  // second; unrelated partitions remain eligible for composition.
  const meetingOwners = new Map<string, string[]>();
  const documentOwners = new Map<string, string[]>();
  for (const { partition, result } of rawPromoted) {
    if (invalid.has(partition.id)) continue;
    for (const meeting of result.value.meetings) {
      meetingOwners.set(meeting.id, [...(meetingOwners.get(meeting.id) ?? []), partition.id]);
    }
    for (const document of result.value.agendaDocuments) {
      documentOwners.set(document.id, [...(documentOwners.get(document.id) ?? []), partition.id]);
    }
  }
  for (const [id, owners] of meetingOwners) {
    if (owners.length < 2) continue;
    for (const owner of new Set(owners)) invalid.set(owner, `MEETING_PARTITION_ID_COLLISION:${id}`);
  }
  for (const [id, owners] of documentOwners) {
    if (owners.length < 2) continue;
    for (const owner of new Set(owners)) invalid.set(owner, `MEETING_PARTITION_DOCUMENT_COLLISION:${id}`);
  }

  const promoted = rawPromoted.filter(({ partition }) => !invalid.has(partition.id));
  const partitionReadbacks: MeetingPartitionReadback[] = reads.map(({ partition, result }) => ({
    contractId: partition.id,
    source: partition.meetingSource,
    bodyId: partition.bodyId,
    scope: partition.scope,
    kind: invalid.has(partition.id) ? "STORE_UNREACHABLE" : result.kind,
    versionId: result.metadata.versionId,
    detail: invalid.get(partition.id) ?? ("detail" in result ? result.detail : null),
  }));

  if (promoted.length > 0) {
    const meetings: Meeting[] = [];
    const agendaDocuments: AgendaDocument[] = [];
    const sources: SnapshotSourceReport[] = [];
    for (const { result } of promoted) {
      meetings.push(...result.value.meetings);
      agendaDocuments.push(...result.value.agendaDocuments);
      sources.push(result.value.sources[0]!);
    }
    for (const { partition } of reads) {
      if (promoted.some((row) => row.partition.id === partition.id)) continue;
      const readback = partitionReadbacks.find((row) => row.contractId === partition.id)!;
      sources.push({
        source: partition.meetingSource,
        ok: false,
        error: `${partition.bodyId}: ${readback.detail ?? "partition unavailable"}`,
        failure: "WALL",
        fetched: 0,
        normalized: 0,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        ...(partition.ocdId ? { unreachableOcdIds: [partition.ocdId] } : {}),
      });
    }
    const collapsed = collapseDuplicateSittings(meetings);
    const retainedIds = new Set(collapsed.rows.map((meeting) => meeting.id));
    const retainedDocuments = agendaDocuments.filter((document) => retainedIds.has(document.meetingId));
    const generatedAt = promoted.map(({ result }) => result.value.generatedAt).sort().at(-1) ?? now;
    const sourceThrough = promoted.map(({ result }) => result.metadata.sourceThrough).filter((value): value is string => value !== null).sort().at(-1) ?? null;
    const retrievedAt = promoted.map(({ result }) => result.metadata.retrievedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
    const promotedAt = promoted.map(({ result }) => result.metadata.promotedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
    const allPartitionsProofValid = promoted.length === MEETING_PARTITION_CONTRACTS.length;
    const stale = promoted.some(({ result }) => result.metadata.stale === "STALE")
      ? "STALE" as const
      : !allPartitionsProofValid || promoted.some(({ result }) => result.metadata.stale === "UNKNOWN")
        ? "UNKNOWN" as const
        : "CURRENT" as const;
    const value: MeetingsSnapshot = {
      formatVersion: 1,
      generatedAt,
      counts: snapshotCounts(collapsed.rows, collapsed.dropped.length),
      sources,
      meetings: collapsed.rows,
      agendaDocuments: retainedDocuments,
    };
    validateSnapshot(value, {
      allowAllSourcesFailedForDurableTransfer: true,
    });
    return {
      kind: "PROMOTED",
      value,
      metadata: {
        recordClass: MEETINGS_RECORD_CLASS,
        scope: MEETINGS_SCOPE,
        sourceId: MEETINGS_SOURCE_ID,
        version: null,
        versionId: null,
        lastKnownGoodVersionId: null,
        sourceThrough,
        retrievedAt,
        promotedAt,
        stale,
        staleAt: null,
      },
      partitions: partitionReadbacks,
      detail: `${promoted.length}/${MEETING_PARTITION_CONTRACTS.length} proof-valid source/body partitions composed; ${invalid.size} invalid partition(s) isolated; aggregate freshness is UNKNOWN until every partition is proof-valid; each version is listed in partitions.${pin === null ? "" : ` Reader proof meeting pin ${pin.partitionsSha256.slice(0, 12)} (captured ${pin.capturedAt}) selected every version.`}`,
    };
  }

  const invalidPromoted = rawPromoted.find(({ partition }) => invalid.has(partition.id));
  if (invalidPromoted) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: invalidPromoted.result.metadata,
      code: "PROMOTION_PROOF_INVALID",
      detail: `${invalidPromoted.partition.id} cannot be composed: ${invalid.get(invalidPromoted.partition.id)}`,
    };
  }

  const invalidRead = reads.find(({ result }) =>
    result.kind === "STORE_UNREACHABLE" && result.code === "PROMOTION_PROOF_INVALID"
  );
  if (invalidRead?.result.kind === "STORE_UNREACHABLE") return invalidRead.result;

  const storeFailure = reads
    .map(({ result }) => result)
    .find((result): result is Extract<CivicDataReadResult<MeetingsSnapshot>, { kind: "STORE_UNREACHABLE" }> => result.kind === "STORE_UNREACHABLE");
  const fixtureEligible = allowUnconfiguredBootstrap && reads.every(({ result }) =>
    result.kind === "NOT_RECORDED" || (
      result.kind === "STORE_UNREACHABLE" &&
      (result.code === "STORE_NOT_CONFIGURED" || result.code === "READ_NOT_INITIALIZED")
    ),
  );
  if (storeFailure && !fixtureEligible) return storeFailure;
  if (fixtureEligible) {
    const fixture = readSnapshot(options.root);
    if (fixture) {
      return {
        kind: "BOOTSTRAP",
        value: fixture,
        metadata: {
          recordClass: MEETINGS_RECORD_CLASS,
          scope: MEETINGS_SCOPE,
          sourceId: MEETINGS_SOURCE_ID,
          version: fixture.generatedAt,
          versionId: `bootstrap:${MEETINGS_RECORD_CLASS}:${MEETINGS_SCOPE}:${fixture.generatedAt}`,
          lastKnownGoodVersionId: null,
          sourceThrough: latestSourceInstant(fixture),
          retrievedAt: fixture.generatedAt,
          promotedAt: null,
          stale: "UNKNOWN",
          staleAt: null,
        },
        detail: "No source/body pointer exists; the explicit test-only first-bootstrap fixture was selected.",
      };
    }
  }
  if (storeFailure) return storeFailure;
  return {
    kind: "NOT_RECORDED",
    value: null,
    metadata: {
      recordClass: MEETINGS_RECORD_CLASS,
      scope: MEETINGS_SCOPE,
      sourceId: null,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "UNKNOWN",
      staleAt: null,
    },
    detail: "The store answered, but no proof-valid source/body meetings partition has been promoted.",
  };
}

/** Convert the typed state to data or a loud serving failure. */
export function requireMeetingsProjection(
  result: MeetingsProjectionReadResult,
): MeetingsSnapshot {
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") return result.value;
  if (result.kind === "STORE_UNREACHABLE") {
    throw new CivicDataStoreUnavailableError(result);
  }
  throw new Error(result.detail);
}

export interface ReaderProofMeetingPartitionAuthority {
  readonly contractId: string;
  readonly kind: "PROMOTED" | "NOT_RECORDED";
  readonly versionId: string | null;
}

export interface ReaderProofMeetingsExpectedAuthority {
  /** Exact counts already validated against the phase import receipt. */
  readonly meetingPartitionsWithLkg: number;
  readonly meetingPartitionsWithoutLkg: number;
  /** Exact legacy aggregate facts authenticated by the phase import receipt. */
  readonly legacyMeetingsAggregate: {
    readonly factSha256: string;
    readonly meetingRowCount: number;
    readonly agendaDocumentRowCount: number;
  };
  /** Exact imported membership and promoted version identities. */
  readonly partitions: readonly ReaderProofMeetingPartitionAuthority[];
}

function readerProofExpectedMeetingAuthority(
  expected: ReaderProofMeetingsExpectedAuthority | undefined,
): ReadonlyMap<string, ReaderProofMeetingPartitionAuthority> {
  if (!expected) {
    throw new Error("Meeting Reader proof expected phase-import authority was not provided.");
  }
  if (
    !expected.legacyMeetingsAggregate ||
    !/^[a-f0-9]{64}$/.test(expected.legacyMeetingsAggregate.factSha256) ||
    !Number.isSafeInteger(expected.legacyMeetingsAggregate.meetingRowCount) ||
    expected.legacyMeetingsAggregate.meetingRowCount <= 0 ||
    !Number.isSafeInteger(expected.legacyMeetingsAggregate.agendaDocumentRowCount) ||
    expected.legacyMeetingsAggregate.agendaDocumentRowCount <= 0
  ) {
    throw new Error("Meeting Reader proof expected legacy aggregate authority is invalid.");
  }
  const registered = new Set(MEETING_PARTITION_CONTRACTS.map(({ id }) => id));
  const ids = expected.partitions.map(({ contractId }) => contractId);
  if (
    ids.length !== registered.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !registered.has(id))
  ) {
    throw new Error("Meeting Reader proof expected authority has a missing, duplicate, or unexpected partition.");
  }
  if (
    !Number.isSafeInteger(expected.meetingPartitionsWithLkg) ||
    expected.meetingPartitionsWithLkg < 0 ||
    !Number.isSafeInteger(expected.meetingPartitionsWithoutLkg) ||
    expected.meetingPartitionsWithoutLkg < 0 ||
    expected.meetingPartitionsWithLkg + expected.meetingPartitionsWithoutLkg !== registered.size
  ) {
    throw new Error("Meeting Reader proof expected authority counts do not cover the registered partition denominator.");
  }
  let promoted = 0;
  let notRecorded = 0;
  for (const partition of expected.partitions) {
    if (partition.kind === "PROMOTED") {
      promoted += 1;
      if (!partition.versionId) {
        throw new Error(`${partition.contractId} expected promoted meeting partition has no version identity.`);
      }
      continue;
    }
    if (partition.kind === "NOT_RECORDED") {
      notRecorded += 1;
      if (partition.versionId !== null) {
        throw new Error(`${partition.contractId} expected NOT_RECORDED meeting partition names a version.`);
      }
      continue;
    }
    throw new Error(`${partition.contractId} expected meeting partition has an invalid disposition.`);
  }
  if (
    promoted !== expected.meetingPartitionsWithLkg ||
    notRecorded !== expected.meetingPartitionsWithoutLkg
  ) {
    throw new Error("Meeting Reader proof expected authority counts differ from its exact membership.");
  }
  return new Map(expected.partitions.map((partition) => [partition.contractId, partition]));
}

/**
 * Documentary Reader proof requires a complete authority readback, including
 * every intentional no-LKG partition. A partially unreadable authority cannot
 * be hidden by the aggregate's normal source-isolation behavior. The expected
 * membership is supplied independently from the already-validated phase
 * import receipt; the projection under test may never authorize itself.
 */
export function requireReaderProofMeetingsProjection(
  result: MeetingsProjectionReadResult,
  expectedAuthority: ReaderProofMeetingsExpectedAuthority,
): MeetingsSnapshot {
  const expectedById = readerProofExpectedMeetingAuthority(expectedAuthority);
  if (result.kind !== "PROMOTED") {
    throw new Error(`Meeting Reader proof authority is ${result.kind}: ${result.detail}`);
  }
  const registered = new Map(MEETING_PARTITION_CONTRACTS.map((partition) => [partition.id, partition]));
  const actual = result.partitions.map(({ contractId }) => contractId);
  if (
    actual.length !== registered.size ||
    new Set(actual).size !== actual.length ||
    actual.some((id) => !registered.has(id))
  ) {
    throw new Error("Meeting Reader proof authority has a missing, duplicate, or unexpected partition readback.");
  }
  let promoted = 0;
  let notRecorded = 0;
  // RULING 290 history note (2026-09-20): partitions the frozen cutover import recorded
  // NOT_RECORDED that the standing runner has since PROMOTED are accepted gains. They are
  // collected and reported below so a drift of one cannot silently become two hundred.
  const gained: string[] = [];
  for (const partition of result.partitions) {
    const contract = registered.get(partition.contractId)!;
    if (
      partition.source !== contract.meetingSource ||
      partition.bodyId !== contract.bodyId ||
      partition.scope !== contract.scope
    ) {
      throw new Error(`${partition.contractId} meeting partition readback identity differs from its registered contract.`);
    }
    if (partition.kind === "PROMOTED") {
      promoted += 1;
      if (!partition.versionId) throw new Error(`${partition.contractId} promoted meeting partition has no version identity.`);
    } else if (partition.kind === "NOT_RECORDED") {
      notRecorded += 1;
      if (partition.versionId !== null) throw new Error(`${partition.contractId} NOT_RECORDED meeting partition names a version.`);
    } else {
      throw new Error(`${partition.contractId} meeting partition is ${partition.kind}: ${partition.detail ?? "no detail"}`);
    }
    const expected = expectedById.get(partition.contractId)!;
    if (partition.kind !== expected.kind) {
      // RULING 290: the standing runner is the sole freshness clock and advances past the
      // frozen cutover import. A GAIN (import NOT_RECORDED -> now PROMOTED = a newly acquired
      // meeting) is accepted — the census reads current production, so the gained partition is
      // PROVEN here, not skipped, and coverage grows. A LOSS (PROMOTED -> NOT_RECORDED = data
      // disappearing) stays a hard failure. Version drift on an already-promoted partition is
      // likewise accepted (exact version match not required, above).
      if (expected.kind === "NOT_RECORDED" && partition.kind === "PROMOTED") {
        gained.push(partition.contractId);
      } else {
        throw new Error(
          `${partition.contractId} meeting partition regressed from the phase import authority: ` +
            `expected ${expected.kind}, got ${partition.kind} (a promoted partition may not lose its LKG).`,
        );
      }
    }
  }
  if (gained.length > 0) {
    console.error(
      `[reader-proof] RULING 290: accepted ${gained.length} runner-promoted meeting partition gain(s) past the frozen import: ${[...gained].sort().join(", ")}`,
    );
  }
  if (
    promoted !== expectedAuthority!.meetingPartitionsWithLkg + gained.length ||
    notRecorded !== expectedAuthority!.meetingPartitionsWithoutLkg - gained.length
  ) {
    throw new Error("Meeting Reader proof authority counts are inconsistent with the phase import denominator plus accepted runner-promoted gains.");
  }
  return result.value;
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
  /** Which durable/read fallback state supplied these rows. */
  dataState?: "PROMOTED" | "BOOTSTRAP";
  /** Canonical/LKG metadata stays visible instead of being inferred from age. */
  versionId?: string | null;
  lastKnownGoodVersionId?: string | null;
  sourceThrough?: string | null;
  retrievedAt?: string | null;
  promotedAt?: string | null;
  stale?: CivicDataReadMetadata["stale"];
  staleAt?: string | null;
  /** Exact canonical versions (or explicit gaps) behind the composed Reader view. */
  partitions?: readonly MeetingPartitionReadback[];
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

export function snapshotClientMeta(
  snapshot: MeetingsSnapshot,
  read?: {
    readonly kind: "PROMOTED" | "BOOTSTRAP";
    readonly metadata: CivicDataReadMetadata;
    readonly partitions?: readonly MeetingPartitionReadback[];
  },
): SnapshotClientMeta {
  const stamps = snapshot.meetings.flatMap((m) =>
    m.carried ? [m.carried.lastFreshAt] : [],
  );
  const days = new Set(stamps.map((iso) => iso.slice(0, 10)));
  return {
    generatedAt: snapshot.generatedAt,
    ...(read
      ? {
          dataState: read.kind,
          versionId: read.metadata.versionId,
          lastKnownGoodVersionId: read.metadata.lastKnownGoodVersionId,
          sourceThrough: read.metadata.sourceThrough,
          retrievedAt: read.metadata.retrievedAt,
          promotedAt: read.metadata.promotedAt,
          stale: read.metadata.stale,
          staleAt: read.metadata.staleAt,
          ...(read.partitions ? { partitions: read.partitions } : {}),
        }
      : {}),
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
export async function getActiveSnapshotMeta(): Promise<SnapshotClientMeta | null> {
  const name = process.env.WTP_MEETING_SOURCE?.trim() || "snapshot";
  if (process.env.NODE_ENV === "production" && name !== "snapshot") {
    throw new Error(`PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL:${name}`);
  }
  if (name !== "snapshot") return null;
  const read = await readMeetingsProjection();
  if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") {
    return snapshotClientMeta(read.value, read);
  }
  if (read.kind === "STORE_UNREACHABLE") {
    throw new CivicDataStoreUnavailableError(read);
  }
  return null;
}
