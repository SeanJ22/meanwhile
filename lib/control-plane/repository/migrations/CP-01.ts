import type { Sql } from "../pg-store.ts";
import { BOOTSTRAP_VERSION, CONTROL_READS_EXPAND_DDL } from "../pg-schema.ts";
import { ADMIN_SECTIONS_EXPAND_DDL, ADMIN_SECTIONS_CONTRACT_DDL, backfillAdminSections } from "../admin-config.ts";
import { DISPATCH_ARCHIVE_MOVE_SQL } from "../dispatch-state.ts";
import { cacheTotals } from "../model-charges.ts";
import { pricedModelCharge, type PricedCharge } from "../../fleet-safety.ts";
import { costRecordId } from "../../spend-window.ts";
import type { CostEntry } from "../../cost.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "../../scheduler/research-policy.ts";

const CHARGE_COLUMNS = "id, charged_at, job_id, route_task_id, obligation_id, jurisdiction, attempt_id, usd, known_usd, measured, bounded, assignment_refs, is_scout, scout_usd, cache";
const chargeFields = (alias: string) => `${alias}->>'id', (${alias}->>'at')::timestamptz, ${alias}->>'jobId',
  ${alias}->>'routeTaskId', ${alias}->>'obligationId', ${alias}->>'jurisdiction', ${alias}->'metered'->>'attemptId',
  (${alias}->>'usd')::double precision, (${alias}->>'knownUsd')::double precision,
  (${alias}->>'measured')::boolean, (${alias}->>'bounded')::boolean, nullif(${alias}->'assignmentRefs','null'::jsonb)`;

// The old deployment keeps writing during expand; capture preserves those charges until contract removes the old table.
const SPEND_CAPTURE_DDL = [
  "CREATE TABLE IF NOT EXISTS cp01_spend_capture (id text PRIMARY KEY, charge jsonb NOT NULL)",
  "CREATE TABLE IF NOT EXISTS cp01_cost_capture (log_key text NOT NULL, position bigint NOT NULL, record jsonb NOT NULL, PRIMARY KEY(log_key,position))",
  `CREATE OR REPLACE FUNCTION cp01_capture_spend() RETURNS trigger LANGUAGE plpgsql AS $capture$
  BEGIN
    WITH pending AS (
      INSERT INTO cp01_spend_capture (id, charge)
      SELECT charge->>'id', charge FROM jsonb_array_elements(
        (CASE WHEN TG_OP = 'UPDATE' THEN OLD.value->'charges' ELSE '[]'::jsonb END) || (NEW.value->'charges')) charge
      WHERE NOT EXISTS (SELECT 1 FROM cp_model_charges c WHERE c.id = charge->>'id')
        OR TG_OP = 'INSERT' OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.value->'charges') previous WHERE previous->>'id' = charge->>'id')
      ON CONFLICT DO NOTHING RETURNING charge
    ) INSERT INTO cp_model_charges (${CHARGE_COLUMNS})
      SELECT ${chargeFields("charge")}, charge->'metered'->>'role' = 'SCOUT'
        AND (charge->'metered'->>'routeId' IS DISTINCT FROM '${SCOUT_PREWARM_ROUTE_ID}'),
        (charge->'metered'->'cost'->>'usd')::double precision, NULL FROM pending
      ON CONFLICT(id) DO UPDATE SET usd = EXCLUDED.usd, known_usd = EXCLUDED.known_usd, measured = EXCLUDED.measured, bounded = EXCLUDED.bounded;
    RETURN NEW;
  END $capture$`,
  `CREATE OR REPLACE FUNCTION cp01_capture_cost() RETURNS trigger LANGUAGE plpgsql AS $capture$
  BEGIN
    INSERT INTO cp01_cost_capture(log_key, position, record) VALUES (NEW.log_key, NEW.position, NEW.record) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END $capture$`,
  `DO $capture$ BEGIN
    IF to_regclass('cp_spend_window') IS NOT NULL THEN
      DROP TRIGGER IF EXISTS cp01_capture_spend ON cp_spend_window;
      CREATE TRIGGER cp01_capture_spend AFTER INSERT OR UPDATE OF value ON cp_spend_window FOR EACH ROW EXECUTE FUNCTION cp01_capture_spend();
    END IF;
    DROP TRIGGER IF EXISTS cp01_capture_cost ON cp_log_costs;
    CREATE TRIGGER cp01_capture_cost AFTER INSERT ON cp_log_costs FOR EACH ROW EXECUTE FUNCTION cp01_capture_cost();
  END $capture$`,
];
const SPEND_CONTRACT_DDL = [
  "DROP TRIGGER IF EXISTS cp01_capture_cost ON cp_log_costs",
  "DROP TABLE IF EXISTS cp_spend_window",
  "DROP FUNCTION IF EXISTS cp01_capture_spend()",
  "DROP FUNCTION IF EXISTS cp01_capture_cost()",
  "DROP TABLE IF EXISTS cp01_spend_capture",
  "DROP TABLE IF EXISTS cp01_cost_capture",
];

export const CP01_DECLARATION_SOURCES = [
  "lib/control-plane/repository/pg-schema.ts", "lib/control-plane/repository/admin-config.ts",
  "lib/control-plane/repository/model-charges.ts", "lib/control-plane/repository/dispatch-state.ts", "lib/method/fix-map.ts",
] as const;
export function controlReadsMigrationDefinition(phase: "expand" | "contract"): string {
  return JSON.stringify(phase === "expand"
    ? { statements: [...new Set([...CONTROL_READS_EXPAND_DDL, ...ADMIN_SECTIONS_EXPAND_DDL, ...SPEND_CAPTURE_DDL])],
      adminBackfill: backfillAdminSections.toString(), version: BOOTSTRAP_VERSION }
    : { statements: [...ADMIN_SECTIONS_CONTRACT_DDL, ...SPEND_CONTRACT_DDL, DISPATCH_ARCHIVE_MOVE_SQL] });
}

async function insertCharges(sql: Sql, charges: readonly PricedCharge[], updateCache = false): Promise<void> {
  if (!charges.length) return;
  await sql.query(`INSERT INTO cp_model_charges (${CHARGE_COLUMNS})
    SELECT ${chargeFields("charge")}, is_scout, (charge->'metered'->'cost'->>'usd')::double precision, cache
    FROM jsonb_to_recordset($1::jsonb) AS rows(charge jsonb, is_scout boolean, cache jsonb)
    ON CONFLICT (id) ${updateCache ? "DO UPDATE SET cache = EXCLUDED.cache" : "DO NOTHING"}`,
  [JSON.stringify(charges.map(charge => ({ charge,
    is_scout: charge.metered.role === "SCOUT" && charge.metered.routeId !== SCOUT_PREWARM_ROUTE_ID, cache: cacheTotals(charge) }))) ]);
}

async function backfillModelCharges(sql: Sql): Promise<void> {
  const present = await sql.query("SELECT to_regclass('cp_spend_window') AS old_table") as { old_table: string | null }[];
  if (!present[0]?.old_table) return;
  let position = 0;
  for (;;) {
    const rows = await sql.query(`SELECT held.charge, held.position FROM cp_spend_window w
      CROSS JOIN LATERAL jsonb_array_elements(w.value->'charges') WITH ORDINALITY AS held(charge, position)
      WHERE w.id = 'model-charges' AND held.position > $1::bigint ORDER BY held.position LIMIT 100`, [position]) as { charge: PricedCharge; position: number }[];
    await insertCharges(sql, rows.map(row => row.charge));
    if (rows.length < 100) break;
    position = Number(rows[rows.length - 1].position);
  }
  let cursor: { key: string; position: number } | null = null;
  for (;;) {
    const rows = await sql.query(`SELECT log_key, position, record FROM cp_log_costs
      WHERE ($1::text IS NULL OR (log_key, position) > ($1, $2::bigint)) ORDER BY log_key, position LIMIT 100`,
    [cursor?.key ?? null, cursor?.position ?? 0]) as { log_key: string; position: number; record: CostEntry }[];
    await insertCharges(sql, rows.flatMap(row => pricedModelCharge(row.record, costRecordId(row.record)) ?? []));
    if (rows.length < 100) break;
    const last = rows[rows.length - 1];
    cursor = { key: last.log_key, position: Number(last.position) };
  }
}

export async function migrateModelCharges(sql: Sql): Promise<void> {
  await backfillModelCharges(sql);
  await sql.query("DROP TABLE IF EXISTS cp_spend_window");
}

async function drainCapturedCharges(sql: Sql): Promise<void> {
  const held = await sql.query("SELECT to_regclass('cp01_spend_capture') AS queue") as { queue: string | null }[];
  if (!held[0]?.queue) return;
  for (;;) {
    const rows = await sql.query("SELECT id, charge FROM cp01_spend_capture ORDER BY id LIMIT 100") as { id: string; charge: PricedCharge }[];
    await insertCharges(sql, rows.map(row => row.charge), true);
    if (rows.length) await sql.query("DELETE FROM cp01_spend_capture WHERE id = ANY($1::text[])", [rows.map(row => row.id)]);
    if (rows.length < 100) break;
  }
  for (;;) {
    const rows = await sql.query("SELECT log_key, position, record FROM cp01_cost_capture ORDER BY log_key, position LIMIT 100") as { log_key: string; position: number; record: CostEntry }[];
    await insertCharges(sql, rows.flatMap(row => pricedModelCharge(row.record, costRecordId(row.record)) ?? []));
    if (rows.length) await sql.query(`DELETE FROM cp01_cost_capture c USING jsonb_to_recordset($1::jsonb) AS done(log_key text, position bigint)
      WHERE c.log_key = done.log_key AND c.position = done.position`, [JSON.stringify(rows.map(({ log_key, position }) => ({ log_key, position })))]);
    if (rows.length < 100) break;
  }
}

export async function expandControlReads(sql: Sql): Promise<void> {
  for (const statement of CONTROL_READS_EXPAND_DDL) await sql.query(statement);
  await sql.query("BEGIN");
  try {
    for (const statement of [...ADMIN_SECTIONS_EXPAND_DDL, ...SPEND_CAPTURE_DDL]) await sql.query(statement);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
  await backfillAdminSections(async (text, params) => await sql.query(text, params) as Record<string, unknown>[]);
  await backfillModelCharges(sql);
  await drainCapturedCharges(sql);
  await sql.query(`INSERT INTO cp_schema_version(singleton,version,applied_at) VALUES (true,$1,now())
    ON CONFLICT(singleton) DO UPDATE SET version = EXCLUDED.version, applied_at = EXCLUDED.applied_at`, [BOOTSTRAP_VERSION]);
}

export async function contractControlReads(sql: Sql): Promise<void> {
  await drainCapturedCharges(sql);
  await sql.query("BEGIN");
  try {
    await sql.query("LOCK TABLE cp_log_costs IN SHARE MODE");
    await sql.query("DO $lock$ BEGIN IF to_regclass('cp_spend_window') IS NOT NULL THEN LOCK TABLE cp_spend_window IN ACCESS EXCLUSIVE MODE; END IF; END $lock$");
    await drainCapturedCharges(sql);
    for (const statement of [...ADMIN_SECTIONS_CONTRACT_DDL, ...SPEND_CONTRACT_DDL]) await sql.query(statement);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
  for (let idle = 0; idle < 10;) {
    const moved = await sql.query(DISPATCH_ARCHIVE_MOVE_SQL) as { moved: number }[];
    if (Number(moved[0].moved) > 0) { idle = 0; continue; }
    const remaining = await sql.query("SELECT EXISTS(SELECT 1 FROM cp_occurrences WHERE value->>'closedAt' IS NOT NULL) AS remaining") as { remaining: boolean }[];
    if (!remaining[0].remaining) return;
    idle++;
  }
  throw new Error("db:apply: CP-01_contract awaits locked closed occurrences; migration remains pending");
}
