import {
  OWNER_SURFACE_FORMAT_VERSION, assertAggregateOnly,
  type FreshnessDetailReference, type FreshnessIncidentSummary, type OwnerDigestRecord,
} from "./owner-surface.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { PlannerSpool } from "./scheduler/planner-spool.ts";

const PAGE_ROWS = 32;
const PAGE_BYTES = 1024 * 1024;

/** Freeze the exact native log once; repeated console, report and local reads
 * stream it in its original order while the digest holds finite examples. */
export function spoolFreshnessCycleLines(planner: PlannerSpool, rows: Iterable<string>) {
  let sequence = 0;
  const examples: string[] = [];
  const table = planner.table<{ sequence: number; line: string }>("cycle-log-lines", row => String(row.sequence));
  for (const line of rows) {
    table.add({ sequence: sequence++, line });
    if (examples.length < 12) examples.push(line);
  }
  return { rows: table.rows.map(row => row.line), count: sequence, examples };
}

/** The report remains in existing owner history, without assembling all its rows in the runner. */
export async function appendFreshnessCycleDetails<T>(
  repos: ControlPlaneRepositories,
  cycle: { readonly cycleId: string; readonly finishedAt: string; readonly testedSha: string | null },
  section: string,
  rows: Iterable<T> | AsyncIterable<T>,
  options: {
    readonly previous?: FreshnessDetailReference;
    /** Acknowledges a successfully appended page before the next page is read. */
    readonly onPage?: (ref: FreshnessDetailReference) => void;
  } = {},
): Promise<FreshnessDetailReference> {
  const logKey = `freshness-details:${cycle.cycleId}:${section}`;
  const previous = options.previous;
  if (previous && (previous.cycleId !== cycle.cycleId || previous.section !== section || previous.logKey !== logKey ||
    !Number.isSafeInteger(previous.rows) || !Number.isSafeInteger(previous.pages) || previous.rows < 0 || previous.pages < 0 ||
    (previous.rows === 0 ? previous.pages !== 0 : previous.pages < 1 || previous.rows < previous.pages || previous.rows > previous.pages * PAGE_ROWS)))
    throw new Error("FRESHNESS_DETAIL_APPEND_REFERENCE_INVALID");
  let page = previous?.pages ?? 0, count = previous?.rows ?? 0, pending: T[] = [], pendingBytes = 0;
  const flush = async () => {
    const key = `${logKey}:${page}`;
    const record: OwnerDigestRecord = {
      formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId: key, writtenAt: cycle.finishedAt,
      headline: `Freshness cycle ${section}`, lines: [], cycleOk: null, testedSha: cycle.testedSha,
      freshnessDetails: { cycleId: cycle.cycleId, section, page, rows: pending },
    };
    assertAggregateOnly(record, "freshness cycle details");
    await repos.ownerDigests.append(key, key, record, cycle.finishedAt);
    page++; pending = []; pendingBytes = 0;
    options.onPage?.({ cycleId: cycle.cycleId, logKey, section, rows: count, pages: page });
  };
  for await (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row) ?? "null", "utf8");
    if (pending.length && pendingBytes + bytes > PAGE_BYTES) await flush();
    pending.push(row); count++; pendingBytes += bytes;
    if (pending.length === PAGE_ROWS) await flush();
  }
  if (pending.length) await flush();
  return { cycleId: cycle.cycleId, logKey, section, rows: count, pages: page };
}

/** Exact details are read one page at a time, in their original order. */
export async function visitFreshnessCycleDetails<T>(
  repos: ControlPlaneRepositories,
  ref: FreshnessDetailReference,
  visit: (row: T) => void | Promise<void>,
): Promise<void> {
  let count = 0;
  for (let page = 0; page < ref.pages; page++) {
    const [record] = await repos.ownerDigests.readRecent(`${ref.logKey}:${page}`, 1);
    const details = record?.freshnessDetails;
    if (!details || record.digestId !== `${ref.logKey}:${page}` || details.cycleId !== ref.cycleId ||
      details.page !== page || details.section !== ref.section) {
      throw new Error(`Freshness report detail page could not be read: ${ref.section} ${page}`);
    }
    for (const row of details.rows) { await visit(row as T); count++; }
  }
  if (count !== ref.rows) throw new Error(`Freshness report detail count differs: ${ref.section}`);
}

/** Causes are a finite scheduler enum; exact targets remain in the report's incident pages. */
export function summarizeFreshnessIncidents(rows: Iterable<FreshnessIncidentSummary>): readonly FreshnessIncidentSummary[] {
  const byCause = new Map<string, FreshnessIncidentSummary>();
  for (const row of rows) {
    const prior = byCause.get(row.cause);
    byCause.set(row.cause, {
      cause: row.cause, target: "All affected places",
      obligationsAffected: (prior?.obligationsAffected ?? 0) + row.obligationsAffected,
      incidents: (prior?.incidents ?? 0) + (row.incidents ?? 1),
      ...(row.oldestHours === undefined && prior?.oldestHours === undefined ? {} : {
        oldestHours: Math.max(prior?.oldestHours ?? 0, row.oldestHours ?? 0),
      }),
      ...(row.nextRetryAt === undefined && prior?.nextRetryAt === undefined ? {} : {
        nextRetryAt: prior?.nextRetryAt === undefined ? row.nextRetryAt : row.nextRetryAt === undefined
          ? prior.nextRetryAt : prior.nextRetryAt < row.nextRetryAt ? prior.nextRetryAt : row.nextRetryAt,
      }),
    });
  }
  return [...byCause.values()].sort((a, b) => a.cause.localeCompare(b.cause));
}
