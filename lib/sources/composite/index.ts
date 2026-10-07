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
 * The composite meeting source: fans one query out across child adapters and merges what comes back.
 * - One source failing never blanks the map: a child that throws or times out is reported as a failure
 *   for that source; the others still return.
 * - Per-source accounting: fetched, normalized and dropped counts with the drop reasons split
 *   (`placeless` ≠ `unknownVenue`), via the `ReportingMeetingSource` contract every child implements.
 * - Namespaced ids: every child's `Meeting.id` must begin with its own source name, or the child is
 *   excluded and reported as a failure.
 * - Acquisition is not authority: each source/body result is persisted and promoted through its own
 *   meeting-partition contract; the composite never becomes a Reader fallback.
 * - Children come from registry data: see `wiring.ts` and `lib/registry/source-wiring.ts`.
 */

/**
 * Why a child contributed nothing.
 * - `WALL`: the retrieval did not land (a refusal, a timeout, a challenge page, an unreachable host).
 *   Never terminal: the source's last known version stays live through its partition pointer.
 * - `JOB`: the run itself is broken (ids outside the child's namespace, or `normalize` threw). The
 *   affected partition records a failed attempt and keeps LKG.
 * There is no blocked kind: a wall is recorded on the rung it stopped at, and the next rung is attempted.
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
   * The furthest ladder rung a walled retrieval reached, in the one canonical ladder numbering. Absent when
   * the client cannot say.
   */
  walledAtRung?: number;
  /**
   * Which ladder this number is in. `CANONICAL` is what every value this code writes means.
   * `PRE_F22_LADDER_UNKNOWN` marks an older value recorded when two numbered ladders existed; such a value
   * keeps its number and is never reinterpreted.
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
   * Partial by scope: what about a division was refused (e.g. the upcoming feed answered and the past feed
   * did not). Completeness is never inferred from `ok: true`.
   */
  partialScopes?: PartialScopeFailure[];
  /**
   * Duplicates split by who decided they were duplicates: the feed's own repeated identifier, or this
   * code's judgement about two records that carried none.
   */
  duplicateIdentity?: DuplicateIdentityCounts;
  /**
   * What the child did with recurring series, forwarded verbatim so each body's partition carries its own
   * publisher exclusions and refusals to expand.
   */
  recurrence?: RecurrenceReport;
  /**
   * The child's own `publishedLookbackDays`, forwarded verbatim so carry-forward judges a carried row
   * against the window that child actually produces.
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
 * One sitting, one row, however many sources carry it, so a body can be wired on a second route (e.g. a
 * town feed alongside an agenda portal) without rendering its sittings twice.
 *
 * The key is `ocdId | bodyName | startsAt` (a null `ocdId` keys on `jurisdiction`). Two bodies at once,
 * one body twice in a day, and two sources disagreeing about the time all stay separate rows. It
 * collapses across sources only: two rows from the same source are that source's own catalogue.
 *
 * The winner is the row that tells the reader more:
 *   1. it carries an `agendaUrl`;
 *   2. it carries `actingBodies`;
 *   3. it carries a `location` rather than only an `online` block;
 *   4. it is not a carried-forward row;
 *   5. otherwise the first seen (source-registration order, stable across runs).
 * The count is reported as `duplicateSittingsCollapsed`.
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
    // The instant, not the string: sources write the same moment with different offsets.
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
 * A rejected child's message, with the transport's own code when the message alone hides it (Node's
 * fetch puts `ENOTFOUND` on `cause.code` behind a bare `TypeError: fetch failed`).
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
        // The failure is the report's job: the other children's rows are already in `tagged`. The furthest
        // ladder rung is recorded when the shared client knows it; a whole-child deadline knows none and stays
        // undefined.
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

      // The child's declared window travels with every report, including failures: a failed child is exactly
      // the one carry-forward has to judge.
      const declaredWindow =
        child.publishedLookbackDays === undefined
          ? {}
          : { publishedLookbackDays: child.publishedLookbackDays };

      if (!fetched.ok) {
        // The retrieval did not land: a WALL when the publisher's side stopped it, a JOB when our own code or
        // configuration threw first. Either way the run continues and the partition keeps its last-known-good.
        children.push({
          source: child.name,
          ok: false,
          error: fetched.error,
          failure: fetched.failureKind ?? "WALL",
          // The rung and the ladder it is in, together.
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

        // A zero-row extraction is a failed extraction, never an empty document. Documents in hand and zero rows
        // out of them is our extraction failing (or a non-calendar page served), so it is never written into
        // the data as an absence. A body that genuinely goes quiet is marked red too; carried rows age out of
        // the serving window on their own. A source reporting drops as well is left alone: it already says why.
        // The drop predicate is the shared one in `normalize-account.ts`.
        // A refused row is not a document in hand. An adapter may keep a row whose retrieval the publisher
        // refused (`{ refused: true }`) so carry-forward keeps that body's sittings. When every row a child
        // fetched was refused, the child fails with the refusal's own kind and words.
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
            // The adapter's own count of records set aside as outside the served window: a counted clip, not a zero.
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
