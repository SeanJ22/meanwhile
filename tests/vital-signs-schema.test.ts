import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES, VITAL_SIGNS_TABLE_DDL } from "../lib/control-plane/repository/pg-schema.ts";

/* The columns the runner's hourly upsert writes (hunters' VITAL_SIGNS_UPSERT), plus River's project-total cross-check. */
const COLUMNS: readonly [string, string][] = [
  ["hour", "timestamptz PRIMARY KEY"], ["facts_live", "integer"], ["facts_confirmed", "integer"], ["facts_sampled", "integer"],
  ["spend_usd", "numeric"], ["unpriced_charges", "integer"], ["cost_per_fact_usd", "numeric"], ["neon_bytes_read", "bigint"],
  ["neon_bytes_by_caller", "jsonb"], ["rounds_finished", "integer"], ["rounds_killed", "integer"], ["rounds_deferred", "integer"],
  ["paid_jobs_ended_empty", "integer"], ["paid_jobs_ended", "integer"], ["neon_project_bytes", "bigint"], ["release_sha", "text"],
  ["written_at", "timestamptz NOT NULL"],
];

test("version 25 declares the hourly vital signs table, one row per hour, counts nullable", () => {
  assert.ok(BOOTSTRAP_VERSION >= 25);
  assert.ok(DECLARED_TABLES.includes("cp_vital_signs"));
  assert.ok(BOOTSTRAP_DDL.includes(VITAL_SIGNS_TABLE_DDL));
  for (const [column, type] of COLUMNS) {
    assert.match(VITAL_SIGNS_TABLE_DDL, new RegExp(`\\n\\s+${column}\\s+${type.replace(/ /g, "\\s+")}\\s*[,\\n]`), column);
  }
  assert.equal((VITAL_SIGNS_TABLE_DDL.match(/NOT NULL/g) ?? []).length, 1, "only written_at is required; a missing count is unknown, not zero");
});
