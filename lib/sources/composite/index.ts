import { isZeroRowExtraction, totalDropped } from "../normalize-account.ts";
import type {
  DuplicateIdentityCounts,
  Meeting,
  MeetingQuery,
  MeetingSource,
  NormalizeDropCounts,
  PartialScopeFailure,
  RecurrenceReport,
  ReportingMeetingSource,
} from "../types.ts";
import {
  captureSourceAcquisitions,
  type SourceAcquisitionEvidence,
} from "../acquisition-trace.ts";
import { runInSourceAcquisitionDomain } from "../acquisition-deadline.ts";
import { fetchFailureKind, type FetchFailureKind } from "./failure-kind.ts";

/**
 * The composite meeting source — trackers **D11**, **D12**, **M06**.
 *
 * Four zips across three states admit no single vendor, which is what settled
 * the composite-versus-hold-the-mock question (`docs/state.md` §5.2 item 1).
 * This fans one query out across child adapters and merges what comes back.
 *
 * The requirements that shaped it, all load-bearing:
 *
 * - **One source failing must never blank the map.** A child that throws or
 *   times out is recorded as a failure for that source; the others still
 *   return. The failure is *reported* — never a silently smaller map.
 * - **Per-source accounting.** Fetched, normalized, and dropped counts with
 *   the drop reasons split (`placeless` ≠ `unknownVenue`, D18), via the
 *   `ReportingMeetingSource` contract every child implements.
 * - **Namespaced ids.** Every child's `Meeting.id` must begin with its own
 *   source name. A child that violates that is excluded and reported as a
 *   failure, because un-namespaced ids collide silently downstream.
 * - **Acquisition is not authority.** This object only fans out one bounded
 *   acquisition. Each source/body result is persisted and promoted through
 *   its own canonical meeting-partition contract; the composite cache never
 *   becomes a Reader fallback or a shared pointer.
 * - **Children come from registry data**, not a hardcoded list — see
 *   `wiring.ts` beside this file and `lib/registry/source-wiring.ts` (§0b).
 */

/**
 * WHY a child contributed nothing — and the two answers are not alike (F22,
 * 2026-08-20).
 *
 * `ok: false` used to carry a vendor timeout and a violated id-namespace
 * contract in the same flag, and `scripts/ingest.ts` treated both the same
 * way: name it, skip it, and carry rows forward inside one aggregate snapshot.
 * So a WALL and a defect in our own code were indistinguishable in the log and
 * in the snapshot — the failed-operation-as-empty-success shape wearing the
 * other face.
 *
 * - `WALL` — the retrieval did not land: a refusal, a timeout, a challenge
 *   page, an unreachable host. The body's records are still there and the
 *   ladder still has rungs; this is friction, and `CLAUDE.md` is explicit
 *   that it is never a terminal state. Carry-forward keeps the source's last
 *   known version stays live through that exact partition pointer, while
 *   independently healthy partitions can still promote.
 * - `JOB` — the run itself is broken: a child returned ids outside its own
 *   namespace, or its `normalize` threw. Nothing about the ladder fixes it,
 *   nobody is waiting for a wall to fall, and a green run would hide it. The
 *   affected source/body partition records a failed attempt and keeps LKG.
 *
 * `SOURCE_BLOCKED` is deliberately not among these: a wall is recorded on the
 * rung it stopped at, and the next rung is attempted.
 */
export type ChildFailureKind = "WALL" | "JOB";

export interface ChildRunReport {
  source: string;
  ok: boolean;
  /** Why the child contributed nothing, when it didn't. */
  error: string | null;
  /**
   * Present exactly when `ok` is false. Both kinds are persisted against only
   * the affected source/body partition; the distinction controls diagnosis,
   * not an aggregate process verdict. See `ChildFailureKind`.
   */
  failure?: ChildFailureKind;
  /**
   * The furthest ladder rung a WALLED retrieval reached — the numbering in
   * `CLAUDE.md` and `docs/source-ladder.md`, never a parallel vocabulary.
   * Absent when the client cannot say, and absent stays absent.
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
   * Divisions this child could not reach while otherwise succeeding — the
   * PARTIAL refusal (g3). Absent or empty means "nothing narrower than the
   * `ok` flag to say".
   */
  unreachableOcdIds?: string[];
  /**
   * **PARTIAL BY SCOPE** — A-004 (external correctness audit of `336a3eb`,
   * remediated 2026-08-24).
   *
   * `unreachableOcdIds` says which divisions were refused. This says WHAT
   * ABOUT a division was refused, which is the distinction an `ical` archive
   * outage falls through: the upcoming feed answered, the past feed did not,
   * the source reported `ok: true`, and every concluded meeting the previous
   * snapshot held for that town was deleted.
   *
   * Completeness is never inferred from `ok: true`.
   */
  partialScopes?: PartialScopeFailure[];
  /**
   * A-005 · duplicates split by who decided they were duplicates — the feed's
   * own repeated identifier, or this code's judgement about two records that
   * carried none. Absent when the child has nothing to say.
   */
  duplicateIdentity?: DuplicateIdentityCounts;
  /**
   * What the child did with recurring series (2026-09-23), forwarded verbatim
   * so each body's partition can carry its own publisher exclusions and its
   * own named refusals to expand.
   */
  recurrence?: RecurrenceReport;
  /**
   * The child's own `publishedLookbackDays` (g13), forwarded verbatim so
   * carry-forward can judge a carried row against the window that child
   * actually produces rather than against the app's serving window. Copied
   * here rather than looked up later because the report is the only thing
   * that survives the run — by the time the snapshot is written the source
   * objects are out of scope.
   */
  publishedLookbackDays?: number | null;
  /** Exact successful HTTP bodies and observed final redirect URLs for this child. */
  acquisitions?: readonly SourceAcquisitionEvidence[];
}

export interface CompositeReport {
  at: string;
  fromCache: boolean;
  children: ChildRunReport[];
  /**
   * How many rows the cross-source merge collapsed as the same sitting
   * published twice. Stated, never silent — see `collapseDuplicateSittings`.
   */
  duplicateSittingsCollapsed: number;
}

/** A child's raw rows, tagged so normalize() can route them back to it. */
export interface TaggedRaw {
  source: string;
  raw: unknown;
}

const ZERO_DROPS: NormalizeDropCounts = {
  placeless: 0,
  unknownVenue: 0,
  unplaceableInTime: 0,
  notConfigured: 0,
};

/** A raw row an adapter kept only to record that its retrieval was refused. */
interface RefusedRawRow {
  readonly refused: true;
  readonly refusedReason?: string;
  readonly refusedKind?: "WALL" | "JOB";
  readonly refusedRung?: number;
}

function isRefusedRow(raw: unknown): raw is RefusedRawRow {
  return typeof raw === "object" && raw !== null && (raw as { refused?: unknown }).refused === true;
}

interface CacheEntry {
  at: number;
  raw: TaggedRaw[];
  fetchReports: Map<string, { ok: boolean; error: string | null; fetched: number; rung?: number; failureKind?: FetchFailureKind; acquisitions?: readonly SourceAcquisitionEvidence[] }>;
}

export interface CompositeOptions {
  /** How long a fetch is served from memory. */
  ttlMs?: number;
  /** How long one child may take before it is recorded as timed out. */
  timeoutMs?: number;
  /** Batch promotion only: bind exact acquired bytes/final redirects into the candidate. */
  captureAcquisitionEvidence?: boolean;
}

/**
 * **ONE SITTING, ONE ROW, HOWEVER MANY SOURCES CARRY IT** (NH Hunt, 2026-08-20).
 *
 * ## Why this had to exist before a second route could be wired
 *
 * The Town of Newbury publishes its whole calendar as an iCalendar feed —
 * 1,157 events, and **24 sittings of its four wired boards inside the serving
 * window against the 16 those boards' existing routes produce.** Eight public
 * meetings a reader at 03255 could not see, sitting in a document the town
 * publishes for exactly this purpose.
 *
 * The obvious move — wire the feed as a second route — was not available,
 * because ids are namespaced PER SOURCE by contract and nothing above them
 * merged. Newbury's Selectboard on 14 September would have rendered twice, and
 * "we show every meeting" would have become "we show some meetings twice",
 * which is a worse failure than the one it fixed.
 *
 * The alternative — swapping the feed in and the old routes out — was
 * measured and REFUSED: the existing routes carry real agendas
 * (`newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370`,
 * `/planning-board/agenda/agenda-15`) and the feed carries none. Trading a
 * reader's agenda for a reader's date is not a trade this product should make.
 *
 * So both routes ship, and the merge decides.
 *
 * ## The key, and what it deliberately does NOT collapse
 *
 * `ocdId | bodyName | startsAt` — the same body, in the same division, sitting
 * at the same instant, is one sitting. Two bodies meeting at once stay two
 * rows; one body meeting twice in a day stays two rows; two sources
 * disagreeing about the TIME stay two rows, which is correct and is a finding
 * rather than a merge — a published disagreement about when a public meeting
 * starts is something a reader should see, not something we should average.
 *
 * A body with a null `ocdId` keys on its `jurisdiction` instead, so two
 * division-less bodies in different places cannot collide.
 *
 * **And it collapses ACROSS SOURCES ONLY.** Two rows from the SAME source at
 * the same instant are that source's own catalogue and are left alone: a board
 * that publishes a Regular Session and an Executive Session both at 18:00 is
 * publishing two meetings, and one adapter reading its own portal is the thing
 * that knows the difference. Cross-source is where the duplication this exists
 * for actually lives, and restricting it there is what stops the merge
 * deleting a real second sitting to tidy up a first.
 *
 * ## Which row wins, and why it is never arbitrary
 *
 * The one that tells the reader more, scored in this order:
 *   1. it carries an `agendaUrl` — the whole reason the swap was refused;
 *   2. it carries `actingBodies` — the D19 join, which only agenda-reading
 *      sources produce;
 *   3. it carries a `location` rather than only an `online` block;
 *   4. it is NOT a carried-forward row, because a fresh row beats a stale one;
 *   5. failing all of that, the first one seen, which is source-registration
 *      order and is stable across runs.
 *
 * **The count is reported, never silent.** `duplicateSittingsCollapsed` rides
 * on the composite's own report, so "fewer meetings than the reader would
 * otherwise have seen" is a stated number with a reason — the same rule every
 * drop counter in this file exists to satisfy.
 */
export function collapseDuplicateSittings(rows: Meeting[],
  /** Optional field reconciliation inside the existing exact-sitting collapse.
   * null keeps both rows when their body/source identities cannot safely join. */
  resolveDuplicate?: (held: Meeting, next: Meeting) => Meeting | null,
): {
  rows: Meeting[];
  collapsed: number;
  /**
   * The rows that lost, kept rather than counted away.
   *
   * The snapshot writer has to know WHICH rows went, not just how many: it
   * runs this a second time after carry-forward and has to reconcile fresh
   * against carried afterwards. A count is not enough to do that with, and
   * deriving it by subtraction is the shape `SnapshotCounts` warns about in
   * its own doc block.
   */
  dropped: Meeting[];
} {
  const informativeness = (m: Meeting): number =>
    (m.agendaUrl ? 8 : 0) +
    (m.actingBodies && m.actingBodies.length > 0 ? 4 : 0) +
    (m.location ? 2 : 0) +
    (m.carried ? 0 : 1);

  const best = new Map<string, Meeting>();
  let collapsed = 0;

  /** The source that minted an id, which namespaces it by contract. */
  const sourceOf = (m: Meeting) => m.id.slice(0, m.id.indexOf(":"));

  const kept: Meeting[] = [];
  const dropped: Meeting[] = [];
  for (const m of rows) {
    /*
     * The INSTANT, not the string. `schedulepage` writes
     * `2026-06-16T19:00:00-04:00` and `ical` writes `2026-06-16T23:00:00.000Z`
     * for the same moment, and keying on the text collapsed nothing at all —
     * the first run of this merge reported `collapsed: 0` against a page that
     * was visibly showing Newbury's Conservation Commission twice. A
     * comparison that cannot see through a timezone offset is not a comparison
     * of times.
     */
    const instant = Date.parse(m.startsAt);
    const key = [
      m.ocdId ?? `jurisdiction:${m.jurisdiction}`,
      m.bodyName,
      Number.isNaN(instant) ? m.startsAt : String(instant),
    ].join("|");
    const held = best.get(key);
    if (!held) {
      best.set(key, m);
      kept.push(m);
      continue;
    }
    if (sourceOf(m) === sourceOf(held)) {
      // Same source, same instant: its own catalogue, and not ours to merge.
      kept.push(m);
      continue;
    }
    if (resolveDuplicate) {
      const resolved = resolveDuplicate(held, m);
      if (resolved === null) { kept.push(m); continue; }
      kept[kept.indexOf(held)] = resolved;
      best.set(key, resolved);
      dropped.push(resolved.id === m.id ? held : m);
      collapsed += 1;
      continue;
    }
    collapsed += 1;
    if (informativeness(m) > informativeness(held)) {
      kept[kept.indexOf(held)] = m;
      best.set(key, m);
      dropped.push(held);
    } else {
      dropped.push(m);
    }
  }

  return { rows: kept, collapsed, dropped };
}

/**
 * A rejected child's message, with the transport's own code when the message
 * alone hides it. Node's fetch rejects a host that no longer resolves with a
 * bare `TypeError: fetch failed` and puts `ENOTFOUND` on `cause.code`; from
 * 2026-09-14 Newbury's retired CivicWeb host was stored ~2,077 times as only
 * "fetch failed", which reads like a flaky network rather than a gone host.
 */
export function childFailureMessage(reason: unknown): string {
  const message = String((reason as { message?: unknown } | null | undefined)?.message ?? reason);
  const code = (reason as { cause?: { code?: unknown } } | null | undefined)?.cause?.code;
  return typeof code === "string" && code && !message.includes(code) ? `${message} (${code})` : message;
}

export class CompositeSource implements MeetingSource<TaggedRaw> {
  readonly name = "composite";

  private readonly children: ReportingMeetingSource<unknown>[];
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly captureAcquisitionEvidence: boolean;
  private readonly cache = new Map<string, CacheEntry>();

  /** The last run's full accounting, for the report script and the route. */
  lastReport: CompositeReport | null = null;
  /** Fresh normalized rows before cross-route Reader composition/deduplication. */
  lastPartitionRows: readonly Meeting[] = [];

  constructor(
    children: ReportingMeetingSource<unknown>[],
    options: CompositeOptions = {},
  ) {
    this.children = children;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.captureAcquisitionEvidence = options.captureAcquisitionEvidence ?? false;
  }

  private cacheKey(query: MeetingQuery): string {
    // One decimal of latitude is ~11 km — coarse enough that the map's
    // repeated queries around one zip share an entry, fine enough that two
    // different zips do not pretend to be one place.
    return [
      query.lat.toFixed(1),
      query.lng.toFixed(1),
      query.radiusKm,
    ].join("|");
  }

  clearCache(): void {
    this.cache.clear();
  }

  async fetch(query: MeetingQuery): Promise<TaggedRaw[]> {
    const key = this.cacheKey(query);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) {
      this.pendingFetch = { reports: cached.fetchReports, fromCache: true };
      return cached.raw;
    }

    const fetchReports = new Map<
      string,
      { ok: boolean; error: string | null; fetched: number; rung?: number; failureKind?: FetchFailureKind; acquisitions?: readonly SourceAcquisitionEvidence[] }
    >();
    const tagged: TaggedRaw[] = [];

    const runChildren = async (
      runForSource: <T>(source: string, operation: () => Promise<T>) => Promise<T>,
    ) => Promise.allSettled(
      this.children.map((child) =>
        runForSource(child.name, () => runInSourceAcquisitionDomain(
          {
            sourceLabel: child.name,
            timeoutMs: this.timeoutMs,
            parentSignal: query.signal,
          },
          (signal) => child.fetch({ ...query, signal }),
        )),
      ),
    );
    const captured = this.captureAcquisitionEvidence
      ? await captureSourceAcquisitions(runChildren)
      : { value: await runChildren((_source, operation) => operation()), evidence: [] };
    const settled = captured.value;

    settled.forEach((result, i) => {
      const child = this.children[i];
      if (result.status === "fulfilled") {
        fetchReports.set(child.name, {
          ok: true,
          error: null,
          fetched: result.value.length,
          ...(this.captureAcquisitionEvidence
            ? { acquisitions: captured.evidence.filter((row) => row.source === child.name) }
            : {}),
        });
        for (const raw of result.value) {
          tagged.push({ source: child.name, raw });
        }
      } else {
        // The failure is the report's job, not the map's problem: the other
        // children's rows are already in `tagged`.
        // F22: the furthest ladder rung this retrieval reached, when the
        // shared client knows it. A whole-child acquisition deadline
        // knows no rung and stays undefined — absent is recorded as absent
        // rather than filled in with a plausible number.
        const rung = (result.reason as { rung?: number } | undefined)?.rung;
        fetchReports.set(child.name, {
          ok: false,
          error: childFailureMessage(result.reason),
          fetched: 0,
          // Whose stopwatch ran out, decided from the thrown value — never
          // assumed to be the publisher's (see ./failure-kind.ts).
          failureKind: fetchFailureKind(result.reason),
          ...(typeof rung === "number" ? { rung } : {}),
          ...(this.captureAcquisitionEvidence
            ? { acquisitions: captured.evidence.filter((row) => row.source === child.name) }
            : {}),
        });
      }
    });

    this.cache.set(key, { at: Date.now(), raw: tagged, fetchReports });
    this.pendingFetch = { reports: fetchReports, fromCache: false };
    return tagged;
  }

  private pendingFetch: {
    reports: Map<string, { ok: boolean; error: string | null; fetched: number; rung?: number; failureKind?: FetchFailureKind; acquisitions?: readonly SourceAcquisitionEvidence[] }>;
    fromCache: boolean;
  } | null = null;

  normalize(raw: TaggedRaw[], now: Date = new Date()): Meeting[] {
    const byChild = new Map<string, unknown[]>();
    for (const { source, raw: row } of raw) {
      const bucket = byChild.get(source) ?? [];
      bucket.push(row);
      byChild.set(source, bucket);
    }

    const fetchInfo = this.pendingFetch;
    const children: ChildRunReport[] = [];
    const merged: Meeting[] = [];

    for (const child of this.children) {
      const fetched = fetchInfo?.reports.get(child.name) ?? {
        ok: true,
        error: null,
        fetched: byChild.get(child.name)?.length ?? 0,
      };

      // The child's declared window travels with every report it appears in,
      // and the FAILURE branch is the one that matters: a failed child is
      // exactly the child carry-forward has to judge, and a report that
      // dropped the declaration on failure would have kept the g13 defect.
      const declaredWindow =
        child.publishedLookbackDays === undefined
          ? {}
          : { publishedLookbackDays: child.publishedLookbackDays };

      if (!fetched.ok) {
        // The retrieval did not land. A WALL when the publisher's side stopped
        // it; a JOB when our own code or configuration threw first (2026-09-24:
        // VENUE_RESOLUTIONS_MISSING was filed as a wall for ten days). Either
        // way the run continues and the partition keeps its last-known-good.
        children.push({
          source: child.name,
          ok: false,
          error: fetched.error,
          failure: fetched.failureKind ?? "WALL",
          // The rung AND the ladder it is in, together — a number with no
          // ladder is what RULING 17 had to go back and mark 50 values for.
          ...(typeof fetched.rung === "number"
            ? { walledAtRung: fetched.rung, rungProvenance: "CANONICAL" as const }
            : {}),
          fetched: 0,
          normalized: 0,
          drops: { ...ZERO_DROPS },
          ...(fetched.acquisitions ? { acquisitions: fetched.acquisitions } : {}),
          ...declaredWindow,
        });
        continue;
      }

      try {
        const { meetings, drops, unreachableOcdIds, partialScopes, duplicateIdentity, recurrence, accounting } =
          child.normalizeWithDrops(
          byChild.get(child.name) ?? [],
          now,
        );

        // Per-source namespacing is the contract; a violator's rows would
        // collide with another source's silently, which is worse than losing
        // the child for a run and saying so.
        const offender = meetings.find(
          (m) => !m.id.startsWith(`${child.name}:`),
        );
        if (offender) {
          children.push({
            source: child.name,
            ok: false,
            error: `meeting id "${offender.id}" is not namespaced under "${child.name}:"`,
            // Our contract, our code, our bug. The vendor answered fine.
            failure: "JOB",
            fetched: fetched.fetched,
            normalized: 0,
            drops: { ...ZERO_DROPS },
            ...declaredWindow,
          });
          continue;
        }

        /*
         * **A ZERO-ROW EXTRACTION IS A FAILED EXTRACTION, NEVER AN EMPTY
         * DOCUMENT** — `CLAUDE.md`, adopted 2026-08-20, and this is the SIXTH
         * sighting of the shape. Fixed here, at the shared path, rather than in
         * the adapter it was found in: every one of the eleven children reaches
         * this line, and only `ical` had any notion of a refusal of its own.
         *
         * FOUND LIVE (Prompt E close-out walk, 2026-08-20). The scheduled
         * refresh at 02:00Z reported `ical` as `ok: true, fetched: 3,
         * normalized: 0`, with every drop counter at zero — three documents in
         * hand and not one event extracted from them, and no drop to say why.
         * Because the source reported success, carry-forward did not run, and
         * **Wilmot, New Hampshire went from 23 meetings to none** on a reader's
         * page at 03255. The feed was healthy when checked by hand minutes
         * later: HTTP 200, 20 events, categories intact.
         *
         * Documents in hand and zero rows out of them is our extraction failing
         * on the vendor's real payload, or an egress being served a page that
         * is not the calendar. Either way it is not a calendar with nothing in
         * it, and it may not be written into the data as an absence.
         *
         * THE TENSION, STATED RATHER THAN HIDDEN. A body that genuinely goes
         * quiet serves a real, empty feed, and this marks that red too. That is
         * the correct trade in this direction: the carried rows are clipped to
         * the serving window and age out on their own within days, whereas a
         * silently emptied town is wrong on the reader's screen immediately and
         * nothing says so. A source reporting zero DROPS as well as zero rows
         * is the narrow case — a source that fetched and dropped everything
         * already tells you why, and is left alone.
         */
        /*
         * S-001 (external correctness audit of `336a3eb`, remediated
         * 2026-08-24). This was a second, independent `droppedAny` boolean —
         * the same `.some((n) => n > 0)` written out again, which is a
         * duplicate implementation of a predicate rather than a second check
         * (RULING 103). It now calls the one in `normalize-account.ts`, so the
         * defence in depth stays and the drift cannot.
         *
         * The sweep for the shape found 2 sites and replaced 2.
         */
        /*
         * **A REFUSED ROW IS NOT A DOCUMENT IN HAND.** (2026-09-24.) An adapter
         * may keep a row whose retrieval the publisher refused, as
         * `{ refused: true }`, so carry-forward can keep that body's sittings.
         * Sutton, NH's feed intermittently answers a Cloudflare managed
         * challenge (403, "Just a moment..."). The fetch layer named it, the
         * iCal row kept it as a refusal, and this guard then counted the row as
         * a document, reported "fetched 1 document(s) and extracted 0
         * meeting(s)" and filed the town's wall as our JOB. Refused rows are
         * now not documents. When every row a child fetched was refused, the
         * child fails with the refusal's own kind and words.
         */
        const refusedRows = (byChild.get(child.name) ?? []).filter(isRefusedRow);
        if (meetings.length === 0 && refusedRows.length > 0 && refusedRows.length >= fetched.fetched) {
          const reasons = [...new Set(refusedRows.map((row) => row.refusedReason).filter((reason): reason is string => Boolean(reason)))];
          const failure = refusedRows.some((row) => row.refusedKind === "JOB") ? "JOB" : "WALL";
          const rungs = refusedRows.map((row) => row.refusedRung).filter((rung): rung is number => typeof rung === "number");
          children.push({
            source: child.name,
            ok: false,
            error:
              `every row this source fetched was refused (${refusedRows.length})` +
              (reasons.length > 0 ? `: ${reasons.slice(0, 3).join("; ")}` : ""),
            failure,
            // The furthest rung the refused retrieval reached, recorded as the
            // fetch-failure branch above records it; absent stays absent.
            ...(failure === "WALL" && rungs.length > 0
              ? { walledAtRung: Math.max(...rungs), rungProvenance: "CANONICAL" as const }
              : {}),
            fetched: fetched.fetched,
            normalized: 0,
            drops,
            ...declaredWindow,
          });
          continue;
        }
        if (
          isZeroRowExtraction({
            documentsInHand: fetched.fetched - refusedRows.length,
            produced: meetings.length,
            dropped: totalDropped(drops),
            // The adapter's own count of records it set aside as outside the
            // served window (2026-09-25): the same term its own guard in
            // accountedNormalize reads. Tucson's IDA publishes a schedule whose
            // every date has passed; that is a counted clip, not a zero.
            outOfWindow: accounting?.outOfWindow ?? 0,
          })
        ) {
          children.push({
            source: child.name,
            ok: false,
            error:
              `fetched ${fetched.fetched} document(s) and extracted 0 meeting(s), ` +
              "with no drop recorded to account for one — a zero-row extraction " +
              "is a failed extraction, never an empty calendar",
            // Our parser, on bytes we already hold. No rung of the ladder is
            // owed; if the bytes were a challenge page, that is an egress wall
            // and the fetch layer is where it must be named.
            failure: "JOB",
            fetched: fetched.fetched,
            normalized: 0,
            drops,
            ...declaredWindow,
          });
          continue;
        }

        merged.push(...meetings);
        children.push({
          source: child.name,
          ok: true,
          error: null,
          fetched: fetched.fetched,
          normalized: meetings.length,
          drops,
          ...(fetched.acquisitions ? { acquisitions: fetched.acquisitions } : {}),
          ...(unreachableOcdIds && unreachableOcdIds.length > 0
            ? { unreachableOcdIds }
            : {}),
          // A-004 · a source can succeed at one scope and fail at another, and
          // `ok: true` may not stand in for both. Forwarded verbatim so
          // carry-forward can preserve the failed scope and no other.
          ...(partialScopes && partialScopes.length > 0 ? { partialScopes } : {}),
          ...(duplicateIdentity ? { duplicateIdentity } : {}),
          ...(recurrence ? { recurrence } : {}),
          ...declaredWindow,
        });
      } catch (error) {
        // The fetch landed and the TRANSFORM threw. The bytes are in hand, so
        // no rung of the ladder is owed and no wall fell — this is our parser
        // on the vendor's real payload, and it goes red.
        children.push({
          source: child.name,
          ok: false,
          error: String((error as Error)?.message ?? error),
          failure: "JOB",
          fetched: fetched.fetched,
          normalized: 0,
          drops: { ...ZERO_DROPS },
          ...(fetched.acquisitions ? { acquisitions: fetched.acquisitions } : {}),
          ...declaredWindow,
        });
      }
    }

    this.lastPartitionRows = merged;
    const { rows, collapsed } = collapseDuplicateSittings(merged);

    this.lastReport = {
      at: now.toISOString(),
      fromCache: fetchInfo?.fromCache ?? false,
      children,
      duplicateSittingsCollapsed: collapsed,
    };
    this.pendingFetch = null;

    return rows;
  }

  async upsert(meetings: Meeting[]) {
    // No tables yet — persistence is its own change (D10).
    return { inserted: 0, updated: meetings.length };
  }
}
