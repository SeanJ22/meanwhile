import { pgEnsureOnlineIndex, type Sql } from "../pg-store.ts";
import { RESEARCH_REVISION_INDEXES } from "../pg-schema.ts";
import { CONTROL_PLANE_REQUEST_BOUNDS_MS } from "../request-bounds.ts";

export function researchRevisionIndexesMigrationDefinition(): string {
  return JSON.stringify({ statements: [...RESEARCH_REVISION_INDEXES.map(index => index.ddl),
    "ANALYZE cp_occurrences", "ANALYZE cp_occurrences_archive"] });
}

export async function buildResearchRevisionIndexes(sql: Sql): Promise<string> {
  const bounds = { ...CONTROL_PLANE_REQUEST_BOUNDS_MS, POINT: 900_000 };
  for (const index of RESEARCH_REVISION_INDEXES) await pgEnsureOnlineIndex(sql, index, bounds);
  for (const table of ["cp_occurrences", "cp_occurrences_archive"]) await sql.query(`ANALYZE ${table}`);
  return `${RESEARCH_REVISION_INDEXES.length} research state/revision indexes`;
}
