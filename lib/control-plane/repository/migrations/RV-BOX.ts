import { pgEnsureOnlineIndex, type Sql } from "../pg-store.ts";
import { BOX_DUE_INDEXES } from "../pg-schema.ts";
import { CONTROL_PLANE_REQUEST_BOUNDS_MS } from "../request-bounds.ts";

/**
 * boxDue walked every waiting Box finding (about 610,000 pages a call) to find the 1,600 due, and from 4 PM EDT Oct 24
 * ran past its 25 s bound on 13 passes, so those passes published no Box facts. Each index is built without blocking the
 * runner's writes, and ANALYZE gives the planner their statistics before the runner reads through them.
 */
export function boxDueIndexesMigrationDefinition(): string {
  return JSON.stringify({ statements: [...BOX_DUE_INDEXES.map(index => index.ddl), "ANALYZE cp_box_findings"] });
}

export async function buildBoxDueIndexes(sql: Sql): Promise<string> {
  // The migration connection keeps the build's long statement budget after each index restores its timeout.
  const bounds = { ...CONTROL_PLANE_REQUEST_BOUNDS_MS, POINT: 900_000 };
  for (const index of BOX_DUE_INDEXES) await pgEnsureOnlineIndex(sql, index, bounds);
  await sql.query("ANALYZE cp_box_findings");
  return `${BOX_DUE_INDEXES.length} Box due indexes`;
}
