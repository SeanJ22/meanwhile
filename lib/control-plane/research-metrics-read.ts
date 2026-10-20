import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import type { ControlPlaneRepositories, RecordProjection } from "./repository/types.ts";
import { cacheDefectCounts, type ResearchMetrics, type ScoutCacheMetricResult, type ScoutOutcomeTotals } from "./research-metrics.ts";

/** Counter fields only: country-wide narratives, findings, instructions and evidence never cross this read. */
export const SCOUT_METRIC_PROJECTION: RecordProjection = {
  attemptId: true, obligationId: true, usd: true, refusal: true, outcome: true, steps: true,
  cacheDefect: ["turns", "stationaryTurns", "zeroReadTurns"],
};

export interface ScoutMetricSummary {
  readonly scoutedCount: number;
  readonly outcomes: ScoutOutcomeTotals;
  readonly cacheDefects: ResearchMetrics["cacheDefects"];
  /** Cache turn counters for exactly the cost-window attempts; duplicate log records retain their original positions. */
  cacheResults(attemptIds: Iterable<string>): Iterable<ScoutCacheMetricResult>;
  close(): Promise<void>;
}

/** Stream lifetime counters and spill distinct IDs/cache counters to temporary disk, bounded by one repository page. */
export async function readScoutMetricSummary(repos: Pick<ControlPlaneRepositories, "scoutResults">): Promise<ScoutMetricSummary> {
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-research-metrics-"));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => {
    exec(sql: string): void; close(): void;
    prepare(sql: string): { run(...values: (string | number)[]): void; get(): { count: number }; iterate(...values: (string|number)[]): Iterable<Record<string,string>> };
  } };
  const db = new DatabaseSync(temporaryPath(join(directory, "counters.sqlite")));
  let closed = false;
  const close = async () => { if (closed) return; closed = true; db.close(); await rm(directory, { recursive: true, force: true }); };
  try {
    db.exec("PRAGMA cache_size=-1024; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE obligations (id TEXT PRIMARY KEY); CREATE TABLE cache (position INTEGER PRIMARY KEY, attempt TEXT NOT NULL, counters TEXT NOT NULL); CREATE INDEX cache_attempt ON cache(attempt); CREATE TABLE selection(owner INTEGER NOT NULL,id TEXT NOT NULL,PRIMARY KEY(owner,id))");
    const obligation = db.prepare("INSERT OR IGNORE INTO obligations(id) VALUES (?)");
    const cache = db.prepare("INSERT INTO cache(position,attempt,counters) VALUES (?,?,?)");
    const outcomes = { measured: 0, unmeasured: 0, spend: 0, routeCandidates: 0, evidenceFound: 0 };
    const defects = { defective: 0, instrumented: 0, stationary: 0, zeroRead: 0 };
    let position = 0;
    await repos.scoutResults.readChangedSince(null, undefined, { projection: SCOUT_METRIC_PROJECTION, page: records => {
      db.exec("BEGIN");
      try {
        for (const { record } of records) {
          if (record.refusal === null) {
            obligation.run(record.obligationId);
            if (record.outcome === "ROUTE_CANDIDATE") outcomes.routeCandidates++;
            if (record.outcome === "EVIDENCE_FOUND") outcomes.evidenceFound++;
          }
          if (record.usd !== null) { outcomes.measured++; outcomes.spend += record.usd ?? 0; }
          else outcomes.unmeasured++;
          const part = cacheDefectCounts([record]);
          defects.defective += part.defective; defects.instrumented += part.instrumented;
          defects.stationary += part.stationary ?? 0; defects.zeroRead += part.zeroRead ?? 0;
          const counters: ScoutCacheMetricResult = { attemptId: record.attemptId,
            ...(record.steps === undefined ? {} : { steps: record.steps.map(step => ({ step: step.step, kind: step.kind, turn: step.turn, tokens: step.tokens })) }),
            ...(record.cacheDefect === undefined ? {} : { cacheDefect: record.cacheDefect }),
          };
          cache.run(position++, record.attemptId, JSON.stringify(counters));
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    } });
    const scoutedCount = Number((db.prepare("SELECT count(*) AS count FROM obligations").get() as { count: number }).count);
    let selection = 0;
    return { scoutedCount, outcomes, cacheDefects: defects, close,
      cacheResults(attemptIds) {
        if (closed) throw new Error("SCOUT_METRIC_SUMMARY_CLOSED");
        const owner = selection++, add = db.prepare("INSERT OR IGNORE INTO selection VALUES(?,?)");
        for (const id of attemptIds) add.run(owner,id);
        return {[Symbol.iterator]: function* () {
          if (closed) throw new Error("SCOUT_METRIC_SUMMARY_CLOSED");
          for (const row of db.prepare("SELECT counters FROM cache WHERE attempt IN(SELECT id FROM selection WHERE owner=?) ORDER BY position").iterate(owner))
            yield JSON.parse(row.counters) as ScoutCacheMetricResult;
        }};
      },
    };
  } catch (error) { await close(); throw error; }
}
