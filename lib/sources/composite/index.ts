import type {
  Meeting,
  MeetingQuery,
  MeetingSource,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

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
 * - **In-memory cache, short TTL, no database.** Live fetching does not need
 *   persistence (D10's row says so in terms); persistence is its own change.
 * - **Children come from registry data**, not a hardcoded list — see
 *   `wiring.ts` beside this file and `lib/registry/source-wiring.ts` (§0b).
 */

/**
 * WHY a child contributed nothing — and the two answers are not alike (F22,
 * 2026-08-20).
 *
 * `ok: false` used to carry a vendor timeout and a violated id-namespace
 * contract in the same flag, and `scripts/ingest.ts` treated both the same
 * way: name it, skip it, carry its rows forward, exit 0. So a WALL and a
 * defect in our own code were indistinguishable in the log, in the snapshot
 * and in the run's exit status — and the defect rendered as a wall, which is
 * the failed-operation-as-empty-success shape wearing the other face.
 *
 * - `WALL` — the retrieval did not land: a refusal, a timeout, a challenge
 *   page, an unreachable host. The body's records are still there and the
 *   ladder still has rungs; this is friction, and `CLAUDE.md` is explicit
 *   that it is never a terminal state. Carry-forward keeps the source's last
 *   known rows and the run stays green, because ten healthy sources must not
 *   lose their refresh over one vendor's edge.
 * - `JOB` — the run itself is broken: a child returned ids outside its own
 *   namespace, or its `normalize` threw. Nothing about the ladder fixes it,
 *   nobody is waiting for a wall to fall, and a green run would hide it. The
 *   run goes red.
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
   * Present exactly when `ok` is false. A `WALL` is named and skipped and the
   * run continues; a `JOB` failure turns the run red. See `ChildFailureKind`.
   */
  failure?: ChildFailureKind;
  /**
   * The furthest ladder rung a WALLED retrieval reached — the numbering in
   * `CLAUDE.md` and `docs/source-ladder.md`, never a parallel vocabulary.
   * Absent when the client cannot say, and absent stays absent.
   */
  walledAtRung?: number;
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
   * The child's own `publishedLookbackDays` (g13), forwarded verbatim so
   * carry-forward can judge a carried row against the window that child
   * actually produces rather than against the app's serving window. Copied
   * here rather than looked up later because the report is the only thing
   * that survives the run — by the time the snapshot is written the source
   * objects are out of scope.
   */
  publishedLookbackDays?: number | null;
}

export interface CompositeReport {
  at: string;
  fromCache: boolean;
  children: ChildRunReport[];
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

interface CacheEntry {
  at: number;
  raw: TaggedRaw[];
  fetchReports: Map<string, { ok: boolean; error: string | null; fetched: number; rung?: number }>;
}

export interface CompositeOptions {
  /** How long a fetch is served from memory. */
  ttlMs?: number;
  /** How long one child may take before it is recorded as timed out. */
  timeoutMs?: number;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class CompositeSource implements MeetingSource<TaggedRaw> {
  readonly name = "composite";

  private readonly children: ReportingMeetingSource<unknown>[];
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  /** The last run's full accounting, for the report script and the route. */
  lastReport: CompositeReport | null = null;

  constructor(
    children: ReportingMeetingSource<unknown>[],
    options: CompositeOptions = {},
  ) {
    this.children = children;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.timeoutMs = options.timeoutMs ?? 20_000;
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
      { ok: boolean; error: string | null; fetched: number; rung?: number }
    >();
    const tagged: TaggedRaw[] = [];

    const settled = await Promise.allSettled(
      this.children.map((child) =>
        withTimeout(child.fetch(query), this.timeoutMs, child.name),
      ),
    );

    settled.forEach((result, i) => {
      const child = this.children[i];
      if (result.status === "fulfilled") {
        fetchReports.set(child.name, {
          ok: true,
          error: null,
          fetched: result.value.length,
        });
        for (const raw of result.value) {
          tagged.push({ source: child.name, raw });
        }
      } else {
        // The failure is the report's job, not the map's problem: the other
        // children's rows are already in `tagged`.
        // F22: the furthest ladder rung this retrieval reached, when the
        // shared client knows it. A whole-child timeout from `withTimeout`
        // knows no rung and stays undefined — absent is recorded as absent
        // rather than filled in with a plausible number.
        const rung = (result.reason as { rung?: number } | undefined)?.rung;
        fetchReports.set(child.name, {
          ok: false,
          error: String(result.reason?.message ?? result.reason),
          fetched: 0,
          ...(typeof rung === "number" ? { rung } : {}),
        });
      }
    });

    this.cache.set(key, { at: Date.now(), raw: tagged, fetchReports });
    this.pendingFetch = { reports: fetchReports, fromCache: false };
    return tagged;
  }

  private pendingFetch: {
    reports: Map<string, { ok: boolean; error: string | null; fetched: number; rung?: number }>;
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
        // The retrieval did not land. A wall, not a broken job — the run
        // continues and carry-forward keeps this source's rows on screen.
        children.push({
          source: child.name,
          ok: false,
          error: fetched.error,
          failure: "WALL",
          ...(typeof fetched.rung === "number"
            ? { walledAtRung: fetched.rung }
            : {}),
          fetched: 0,
          normalized: 0,
          drops: { ...ZERO_DROPS },
          ...declaredWindow,
        });
        continue;
      }

      try {
        const { meetings, drops, unreachableOcdIds } = child.normalizeWithDrops(
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

        merged.push(...meetings);
        children.push({
          source: child.name,
          ok: true,
          error: null,
          fetched: fetched.fetched,
          normalized: meetings.length,
          drops,
          ...(unreachableOcdIds && unreachableOcdIds.length > 0
            ? { unreachableOcdIds }
            : {}),
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
          ...declaredWindow,
        });
      }
    }

    this.lastReport = {
      at: now.toISOString(),
      fromCache: fetchInfo?.fromCache ?? false,
      children,
    };
    this.pendingFetch = null;

    return merged;
  }

  async upsert(meetings: Meeting[]) {
    // No tables yet — persistence is its own change (D10).
    return { inserted: 0, updated: meetings.length };
  }
}
