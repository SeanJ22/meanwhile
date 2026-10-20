import {
  OWNER_SURFACE_FORMAT_VERSION, assertAggregateOnly,
  type FreshnessDetailReference, type FreshnessIncidentSummary, type OwnerDigestRecord,
} from "./owner-surface.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";

const PAGE_ROWS = 32;
const PAGE_BYTES = 1024 * 1024;

/** The report remains in existing owner history, without assembling all its rows in the runner. */
export async function appendFreshnessCycleDetails<T>(
  repos: ControlPlaneRepositories,
  cycle: { readonly cycleId: string; readonly finishedAt: string; readonly testedSha: string | null },
  section: string,
  rows: Iterable<T>,
): Promise<FreshnessDetailReference> {
  const logKey = `freshness-details:${cycle.cycleId}:${section}`;
  let page = 0, count = 0, pending: T[] = [], pendingBytes = 0;
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
  };
  for (const row of rows) {
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
