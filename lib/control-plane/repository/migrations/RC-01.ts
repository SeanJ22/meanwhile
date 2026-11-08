import { pgEnsureOnlineIndex, type Sql } from "../pg-store.ts";
import { PLANNED_WORK_ITEM_INDEXES } from "../pg-schema.ts";
import { CONTROL_PLANE_REQUEST_BOUNDS_MS } from "../request-bounds.ts";

/**
 * The research cycle's coordinator read scanned all 840,000 archived work items to find the 17,000 that carry a plan, and
 * on Nov 6 and 7 ran past its 25 s bound in cycle after cycle, so no research work moved. Each index is built without
 * blocking the runner's writes, and ANALYZE gives the planner their statistics before the runner reads through them.
 */
export function plannedWorkItemIndexesMigrationDefinition(): string {
  return JSON.stringify({ statements: [...PLANNED_WORK_ITEM_INDEXES.map(index => index.ddl), "ANALYZE cp_work_items", "ANALYZE cp_work_items_archive"] });
}

export async function buildPlannedWorkItemIndexes(sql: Sql): Promise<string> {
  const bounds = { ...CONTROL_PLANE_REQUEST_BOUNDS_MS, POINT: 900_000 };
  for (const index of PLANNED_WORK_ITEM_INDEXES) await pgEnsureOnlineIndex(sql, index, bounds);
  for (const table of ["cp_work_items", "cp_work_items_archive"]) await sql.query(`ANALYZE ${table}`);
  return `${PLANNED_WORK_ITEM_INDEXES.length} planned work item indexes`;
}
