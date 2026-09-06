import { createGuardedNeon } from "../../db/guarded-neon.ts";
import type { StandingObligation, FreshnessOccurrence } from "../scheduler/durable.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";
import type { ArtifactRecord, DispositionCommit } from "./types.ts";
import { BOOTSTRAP_VERSION } from "./pg-schema.ts";

export interface HoldingsReadback {
  formatVersion: 1;
  observed_at: string;
  source: { store: string; identity: string; schemaVersion: number; instrument: string };
  obligations: StandingObligation[];
  occurrences: FreshnessOccurrence[];
  debts: FreshnessDebt[];
  routeTasks: RouteTask[];
  workItems: WorkItem[];
  dispositions: DispositionCommit[];
  artifacts: ArtifactRecord[];
}

// One SELECT observes every table at the same MVCC snapshot. This path cannot
// initialize the schema, and neither the connection nor credentials are output.
export const HOLDINGS_READBACK_SQL = `SELECT
  statement_timestamp() AS observed_at,
  current_database() AS database_name,
  current_schema() AS schema_name,
  (SELECT version FROM cp_schema_version WHERE singleton = true) AS schema_version,
  (SELECT coalesce(jsonb_agg(value ORDER BY id), '[]'::jsonb) FROM cp_obligations) AS obligations,
  (SELECT coalesce(jsonb_agg(value ORDER BY id), '[]'::jsonb) FROM cp_occurrences) AS occurrences,
  (SELECT coalesce(jsonb_agg(value ORDER BY id), '[]'::jsonb) FROM cp_debts) AS debts,
  (SELECT coalesce(jsonb_agg(value ORDER BY id), '[]'::jsonb) FROM cp_route_tasks) AS route_tasks,
  (SELECT coalesce(jsonb_agg(value ORDER BY id), '[]'::jsonb) FROM cp_work_items) AS work_items,
  (SELECT coalesce(jsonb_agg(record ORDER BY log_key, position), '[]'::jsonb) FROM cp_log_dispositions) AS dispositions,
  (SELECT coalesce(jsonb_agg(record ORDER BY log_key, position), '[]'::jsonb) FROM cp_log_artifacts) AS artifacts`;

export function decodeHoldingsReadback(rows: Record<string, unknown>[]): HoldingsReadback {
  const r = rows[0];
  if (rows.length !== 1 || !r || Number(r.schema_version) !== BOOTSTRAP_VERSION) {
    throw new Error("Control-plane readback did not observe exactly one supported schema identity");
  }
  for (const key of ["obligations", "occurrences", "debts", "route_tasks", "work_items", "dispositions", "artifacts"]) {
    if (!Array.isArray(r[key])) throw new Error(`Control-plane readback missing array: ${key}`);
  }
  if (!(r.obligations as unknown[]).length) throw new Error("Control-plane returned zero obligations: failed readback floor");
  if (!r.database_name || !r.schema_name) throw new Error("Control-plane source identity absent");
  return {
    formatVersion: 1,
    observed_at: new Date(r.observed_at as string).toISOString(),
    source: {
      store: "Postgres control plane",
      identity: `WTP_CONTROL_PLANE_DATABASE_URL / ${r.database_name} / ${r.schema_name}`,
      schemaVersion: Number(r.schema_version),
      instrument: "scripts/lane-c-readback.mts --json",
    },
    obligations: r.obligations as StandingObligation[],
    occurrences: r.occurrences as FreshnessOccurrence[],
    debts: r.debts as FreshnessDebt[],
    routeTasks: r.route_tasks as RouteTask[],
    workItems: r.work_items as WorkItem[],
    dispositions: r.dispositions as DispositionCommit[],
    artifacts: r.artifacts as ArtifactRecord[],
  };
}

export async function readHoldingsControlPlane(connectionString: string): Promise<HoldingsReadback> {
  const sql = createGuardedNeon(connectionString, { destination: "control-plane" });
  return decodeHoldingsReadback(await sql.query(HOLDINGS_READBACK_SQL) as Record<string, unknown>[]);
}
