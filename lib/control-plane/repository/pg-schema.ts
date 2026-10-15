/** The control-plane schema, versioned in this module. */

import { FIX_MAP_DDL } from "../../method/fix-map.ts";
import { WEBSITE_PACING_DDL } from "../website-pacing.ts";

/** Moves whenever `BOOTSTRAP_DDL` moves. The gate compares against it. */
export const BOOTSTRAP_VERSION = 32;

/**
 *   AGGREGATE     id, revision, updated_at, value   (CAS on revision)
 *   APPEND_ONLY   key, record_id, position, record  (unique on log and record_id)
 * Values are `jsonb`: the domain types own their fields.
 */
export const AGGREGATE_KINDS = [
  "work_items",
  "route_tasks",
  "attempts",
  "leases",
  "budget",
  "obligations",
  "occurrences",
  "debts",
  "owner_snapshots",
  "runner_heartbeat",
  "cache_observations",
  "research_state",
  "spend_window",
  /* Method-candidate lifecycle is runtime state, never a tracked Git file. */
  "method_candidates",
  "readiness_snapshots",
  "admin_config",
  "field_manual",
  /** The field manual, one row per entry. */
  "field_manual_entries",
  "ask_gap_observations",
  "doors",
  /** Original-byte copy requests; never source acquisition or a second scheduler. */
  "admin_evidence_copy_requests",
  /** The owner's research-lead uploads, one row per order. */
  "lead_orders",
  "box_findings",
] as const;

export const APPEND_ONLY_LOGS = [
  "transitions",
  "escalations",
  "dispositions",
  "artifacts",
  "costs",
  "owner_digests",
  "owner_decisions",
  "research_intents",
  "scout_results",
  "worker_results",
  "promotion_pipeline",
  "window_runs",
  "window_incidents",
  "window_intents",
  "software_release_reviews",
  "admin_receipts",
  "agent_jobs",
  "discovery_attempts",
  "live_audits",
] as const;

/** Every table this schema declares, for the drift check. */
export const DECLARED_TABLES: readonly string[] = [
  "cp_schema_version",
  "cp_log_heads",
  "cp_admin_action_history_projection",
  "cp_admin_action_history_scope_ref",
  "cp_admin_action_history_readiness",
  "cp_checklist_scope_heads",
  "cp_checklist_instance_projections",
  "cp_spend_holds",
  "cp_vital_signs",
  "cp_fix_map",
  "cp_website_pacing",
  ...AGGREGATE_KINDS.map((k) => `cp_${k}`),
  ...APPEND_ONLY_LOGS.map((l) => `cp_log_${l}`),
];

/** One statement per entry: the HTTP driver prepares every query, and Postgres refuses multiple commands in a prepared statement. */
function aggregateTable(name: string): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS cp_${name} (
      id          text PRIMARY KEY,
      revision    bigint NOT NULL,
      updated_at  timestamptz NOT NULL,
      value       jsonb NOT NULL,
      changed_at  timestamptz NOT NULL DEFAULT now()
    );`,
  ];
}

/** Unique per log key, enforced by the database: concurrent inserts under READ COMMITTED could otherwise share a position and make replay order ambiguous. */
function appendOnlyTable(name: string): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS cp_log_${name} (
      log_key     text NOT NULL,
      record_id   text NOT NULL,
      position    bigint NOT NULL,
      recorded_at timestamptz NOT NULL,
      record      jsonb NOT NULL,
      changed_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (log_key, record_id)
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS cp_log_${name}_order
      ON cp_log_${name} (log_key, position);`,
  ];
}

export const ARTIFACT_SOURCE_INDEX_DDL = `CREATE INDEX CONCURRENTLY IF NOT EXISTS cp_log_artifacts_source_url
     ON cp_log_artifacts (md5(record->>'canonicalUrl'), (record->>'recordedAt') DESC NULLS LAST, (record->>'artifactId') ASC);`;

/** One index the bootstrap builds online, with the name its catalog status is read by. */
export interface OnlineIndex { readonly name: string; readonly ddl: string; readonly inProgressCode: string }

export const ARTIFACT_SOURCE_INDEX: OnlineIndex = { name: "cp_log_artifacts_source_url", ddl: ARTIFACT_SOURCE_INDEX_DDL,
  inProgressCode: "CONTROL_PLANE_SOURCE_INDEX_BUILD_IN_PROGRESS" };

function onlineIndex(name: string, on: string): OnlineIndex {
  return { name, ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${on};`, inProgressCode: "CONTROL_PLANE_INDEX_BUILD_IN_PROGRESS" };
}

/** The scoped history reads' indexes, each on the exact expression its read sends. */
export const SCOPED_HISTORY_INDEXES: readonly OnlineIndex[] = [
  onlineIndex("cp_attempts_work_item", "cp_attempts ((value #>> '{workItemId}'))"),
  onlineIndex("cp_route_tasks_work_item", "cp_route_tasks ((value #>> '{workItemId}'))"),
  onlineIndex("cp_occurrences_work_item", "cp_occurrences ((value #>> '{workItemId}'))"),
  onlineIndex("cp_occurrences_obligation_path", "cp_occurrences ((value #>> '{obligationId}'))"),
  onlineIndex("cp_work_items_repair_parent", "cp_work_items ((value #>> '{planRepair,parentWorkItemId}'))"),
  onlineIndex("cp_work_items_subject", "cp_work_items ((value #>> '{subject}'))"),
  onlineIndex("cp_log_scout_results_subject", "cp_log_scout_results ((record #>> '{subjectId}'))"),
  onlineIndex("cp_log_artifacts_work_item", "cp_log_artifacts ((record #>> '{workItemId}'))"),
  onlineIndex("cp_log_artifacts_artifact_id", "cp_log_artifacts ((record #>> '{artifactId}'))"),
  onlineIndex("cp_log_costs_recorded_at", "cp_log_costs (recorded_at)"),
  onlineIndex("cp_work_items_publication_contract", "cp_work_items ((value #>> '{autonomousPlan,publication,contractId}'))"),
  onlineIndex("cp_work_items_publication_body", "cp_work_items ((value #>> '{autonomousPlan,publication,bodyId}'))"),
  onlineIndex("cp_work_items_contract_subject", "cp_work_items ((value #>> '{autonomousPlan,contract,subjectId}'))"),
  onlineIndex("cp_box_findings_due", "cp_box_findings ((value #>> '{waitingFor,slots}'), (value->>'lastRecordedAt')) WHERE value->>'state' = 'waiting'"),
  onlineIndex("cp_box_findings_lease", "cp_box_findings ((value #>> '{claim,expiresAt}')) WHERE value->>'state' = 'taken'"),
  onlineIndex("cp_box_findings_reason", "cp_box_findings ((value #>> '{waitingFor,reason}'), id) WHERE value->>'state' = 'waiting'"),
];

/** Every aggregate and log table this schema declares, each of which carries `changed_at`. */
export const CHANGED_AT_TABLES: readonly string[] = [
  ...AGGREGATE_KINDS.map((k) => `cp_${k}`),
  ...APPEND_ONLY_LOGS.map((l) => `cp_log_${l}`),
];

/** The trigger function that stamps `changed_at` with the database clock on every UPDATE. */
export const CHANGED_AT_TOUCH_FUNCTION_DDL = `CREATE OR REPLACE FUNCTION cp_touch_changed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END $$;`;

/** The catalog is asked first, so a current database takes no lock; otherwise the ALTER is metadata only. */
export function changedAtColumnDdl(table: string): string {
  if (!/^cp_[a-z0-9_]+$/.test(table)) throw new Error(`unsafe control-plane table name ${JSON.stringify(table)}`);
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = 'changed_at') THEN
    ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${table}_changed_at' AND tgrelid = '${table}'::regclass) THEN
    -- Two first bootstraps can both pass the check; the second one's duplicate is the same trigger.
    BEGIN
      CREATE TRIGGER ${table}_changed_at BEFORE UPDATE ON ${table}
FOR EACH ROW EXECUTE FUNCTION cp_touch_changed_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;`;
}

/** The `changed_at` indexes for the tables the runner reads whole, built online. */
export const CHANGED_AT_INDEXES: readonly OnlineIndex[] = [
  "cp_work_items", "cp_attempts", "cp_route_tasks", "cp_occurrences", "cp_leases", "cp_obligations", "cp_debts",
  "cp_log_artifacts", "cp_log_scout_results", "cp_log_worker_results", "cp_log_costs", "cp_log_dispositions",
  "cp_log_promotion_pipeline",
].map(table => onlineIndex(`${table}_changed_at`, `${table} (changed_at)`));

/** Refuses what a changed-since read could not see: rewriting or deleting a log record, or deleting an aggregate. */
export const REJECT_REWRITE_FUNCTION_DDL = `CREATE OR REPLACE FUNCTION cp_reject_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is refused: logs are insert-only and aggregates are never deleted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;`;

/** A log refuses UPDATE and DELETE; an aggregate refuses DELETE (its updates are compare-and-sets that stamp `changed_at`). */
export function rejectRewriteDdl(table: string): string {
  if (!/^cp_[a-z0-9_]+$/.test(table)) throw new Error(`unsafe control-plane table name ${JSON.stringify(table)}`);
  const refused = table.startsWith("cp_log_") ? "UPDATE OR DELETE" : "DELETE";
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${table}_no_rewrite' AND tgrelid = '${table}'::regclass) THEN
    BEGIN
      CREATE TRIGGER ${table}_no_rewrite BEFORE ${refused} ON ${table}
FOR EACH ROW EXECUTE FUNCTION cp_reject_rewrite();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;`;
}

/** The RouteTask lookups, on the exact expression `listWhere(["routeTaskId"])` sends. */
export const ROUTE_TASK_INDEXES: readonly OnlineIndex[] = [
  onlineIndex("cp_attempts_route_task", "cp_attempts ((value #>> '{routeTaskId}'))"),
  onlineIndex("cp_leases_route_task", "cp_leases ((value #>> '{routeTaskId}'))"),
];

/** The hourly vital signs row the runner upserts (`vital-signs.ts` VITAL_SIGNS_UPSERT). */
export const VITAL_SIGNS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS cp_vital_signs (
     hour                  timestamptz PRIMARY KEY,
     facts_live            integer,
     facts_confirmed       integer,
     facts_sampled         integer,
     spend_usd             numeric,
     unpriced_charges      integer,
     cost_per_fact_usd     numeric,
     neon_bytes_read       bigint,
     neon_bytes_by_caller  jsonb,
     rounds_finished       integer,
     rounds_killed         integer,
     rounds_deferred       integer,
     paid_jobs_ended_empty integer,
     paid_jobs_ended       integer,
     neon_project_bytes    bigint,
     release_sha           text,
     written_at            timestamptz NOT NULL
   );`;

/** One row per spend hold. `cost_recorded_at` is null until the hold's job is settled. */
export const SPEND_HOLDS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS cp_spend_holds (
     hold_id          text PRIMARY KEY,
     job_id           text NOT NULL,
     obligation_id    text NOT NULL,
     keys             text[] NOT NULL,
     lifetime_keys    text[] NOT NULL DEFAULT '{}',
     usd              numeric NOT NULL,
     held_at          timestamptz NOT NULL,
     what             text NOT NULL,
     settled_usd      numeric,
     cost_recorded_at timestamptz,
     changed_at       timestamptz NOT NULL DEFAULT now()
   );`;

/** Each index is created only when the catalog lacks it, so a current database takes no lock. */
export const SPEND_HOLDS_INDEXES: readonly { readonly name: string; readonly on: string }[] = [
  { name: "cp_spend_holds_keys", on: "cp_spend_holds USING gin (keys)" },
  { name: "cp_spend_holds_job", on: "cp_spend_holds (job_id)" },
  { name: "cp_spend_holds_unsettled", on: "cp_spend_holds (held_at) WHERE cost_recorded_at IS NULL" },
  { name: "cp_spend_holds_settled", on: "cp_spend_holds (cost_recorded_at) WHERE cost_recorded_at IS NOT NULL" },
  { name: "cp_spend_holds_held_at", on: "cp_spend_holds (held_at)" },
];

export const SPEND_HOLDS_INDEXES_DDL = `DO $do$ BEGIN
${SPEND_HOLDS_INDEXES.map(i => `  IF to_regclass('${i.name}') IS NULL THEN
    CREATE INDEX IF NOT EXISTS ${i.name} ON ${i.on};
  END IF;`).join("\n")}
END $do$;`;

/** A hold row as the `SpendHold` JSON every reader takes, instants as `toISOString()` writes them. */
export function spendHoldJsonSql(alias: string): string {
  const iso = (column: string) => `to_char(${alias}.${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  return `jsonb_build_object('holdId', ${alias}.hold_id, 'jobId', ${alias}.job_id, 'obligationId', ${alias}.obligation_id, ` +
    `'keys', to_jsonb(${alias}.keys), 'lifetimeKeys', to_jsonb(${alias}.lifetime_keys), 'usd', ${alias}.usd, ` +
    `'heldAt', ${iso("held_at")}, 'what', ${alias}.what, 'settled', CASE WHEN ${alias}.cost_recorded_at IS NULL THEN 'null'::jsonb ` +
    `ELSE jsonb_build_object('usd', ${alias}.settled_usd, 'costRecordedAt', ${iso("cost_recorded_at")}) END)`;
}

/**
 * A hold that still counts (`liveSpendHolds`), as SQL over `alias`, given the
 * three instants it is measured from: the 24-hour window's start, the stale
 * line for unsettled holds, and the retention line for settled ones.
 */
export function spendHoldLiveSql(alias: string, windowStart: string, staleBefore: string, keptSince: string): string {
  return `((cardinality(${alias}.lifetime_keys) > 0 OR ${alias}.held_at >= ${windowStart}) AND ` +
    `CASE WHEN ${alias}.cost_recorded_at IS NULL THEN ${alias}.held_at >= ${staleBefore} ELSE ${alias}.cost_recorded_at >= ${keptSince} END)`;
}

/** Exactly NOT `spendHoldLiveSql`, written as the disjunction its indexes serve. */
export function spendHoldDeadSql(alias: string, windowStart: string, staleBefore: string, keptSince: string): string {
  return `((${alias}.cost_recorded_at IS NULL AND ${alias}.held_at < ${staleBefore}) OR ` +
    `(${alias}.cost_recorded_at IS NOT NULL AND ${alias}.cost_recorded_at < ${keptSince}) OR ` +
    `(cardinality(${alias}.lifetime_keys) = 0 AND ${alias}.held_at < ${windowStart}))`;
}

/** The marker the bootstrap looks for in the installed body; move it whenever the function's body moves. */
export const ADMIT_SPEND_HOLD_MARKER = "cp_admit_spend_hold body v1";

/**
 * One line's left, as `leftUsd` computes it: budget − (history + every live
 * hold on it in its window unsettled + settled spend recorded after the
 * line's history read), normalized at nanodollar precision.
 */
const LINE_LEFT_SQL = `(SELECT round(((l->>'budgetUsd')::numeric - ((l->>'historicalUsd')::numeric + coalesce(sum(
        CASE WHEN h.cost_recorded_at IS NULL THEN h.usd
             WHEN h.cost_recorded_at > (l->>'historyReadAt')::timestamptz THEN h.settled_usd
             ELSE 0 END), 0))) * 1000000000) / 1000000000
      FROM cp_spend_holds h
      WHERE h.keys @> ARRAY[l->>'key'] AND ${spendHoldLiveSql("h", "win", "stale", "kept")}
        AND (coalesce((l->>'lifetime')::boolean, false) OR h.held_at >= win))`;

/**
 * `decideHold`, in the database. Returns `{admit: true, hold}` or `{admit: false, refusal, left, position}`.
 * Unlike `decideHold`, a line whose left cannot be computed refuses rather than comparing NaN.
 */
export const ADMIT_SPEND_HOLD_FUNCTION_DDL = `DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cp_admit_spend_hold'
      AND pronamespace = current_schema()::regnamespace AND prosrc LIKE '%${ADMIT_SPEND_HOLD_MARKER}%') THEN
    BEGIN
      CREATE OR REPLACE FUNCTION cp_admit_spend_hold(hold jsonb, lines jsonb, now_at timestamptz,
          window_ms bigint, stale_ms bigint, retention_ms bigint, prune_limit integer)
        RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $fn$
      -- ${ADMIT_SPEND_HOLD_MARKER}
      DECLARE
        hid text := hold->>'holdId';
        amount numeric := (hold->>'usd')::numeric;
        win timestamptz := now_at - window_ms * interval '1 millisecond';
        stale timestamptz := now_at - stale_ms * interval '1 millisecond';
        kept timestamptz := now_at - retention_ms * interval '1 millisecond';
        sends jsonb := coalesce(lines->'sends', '[]'::jsonb);
        areas jsonb := coalesce(lines->'areas', '[]'::jsonb);
        line_keys text[];
        k text;
        l jsonb;
        line_left numeric;
        first_left numeric;
        fits boolean := false;
        pos integer := 0;
        found_hold jsonb;
      BEGIN
        SELECT coalesce(array_agg(DISTINCT e->>'key' ORDER BY e->>'key'), '{}') INTO line_keys
          FROM jsonb_array_elements(sends || areas) AS e;
        -- One lock per line, in one order, held until this statement's transaction ends.
        FOREACH k IN ARRAY line_keys LOOP
          PERFORM pg_advisory_xact_lock(hashtextextended('cp_spend_holds:' || k, 0));
        END LOOP;
        -- What no longer counts is deleted, never read again: this hold id, then the dead holds on these lines.
        DELETE FROM cp_spend_holds d WHERE d.hold_id = hid AND ${spendHoldDeadSql("d", "win", "stale", "kept")};
        IF cardinality(line_keys) > 0 THEN
          DELETE FROM cp_spend_holds x WHERE x.hold_id IN (SELECT d.hold_id FROM cp_spend_holds d
            WHERE d.keys && line_keys AND ${spendHoldDeadSql("d", "win", "stale", "kept")} LIMIT prune_limit);
        END IF;
        -- Idempotent by hold id.
        SELECT ${spendHoldJsonSql("h")} INTO found_hold FROM cp_spend_holds h WHERE h.hold_id = hid;
        IF found_hold IS NOT NULL THEN RETURN jsonb_build_object('admit', true, 'hold', found_hold); END IF;
        IF cardinality(line_keys) = 0 THEN RETURN jsonb_build_object('admit', true, 'hold', 'null'::jsonb); END IF;
        IF amount IS NULL OR amount < 0 THEN RETURN jsonb_build_object('admit', false, 'refusal', 'AMOUNT'); END IF;
        -- Sends: one with room suffices.
        IF jsonb_array_length(sends) > 0 THEN
          FOR l IN SELECT e FROM jsonb_array_elements(sends) WITH ORDINALITY AS t(e, n) ORDER BY n LOOP
            line_left := ${LINE_LEFT_SQL};
            IF first_left IS NULL THEN first_left := coalesce(line_left, 0); END IF;
            IF line_left >= amount THEN fits := true; EXIT; END IF;
          END LOOP;
          IF NOT fits THEN RETURN jsonb_build_object('admit', false, 'refusal', 'SEND', 'left', first_left); END IF;
        END IF;
        -- Every area, then every lifetime Send: each must have room.
        FOR l IN SELECT e FROM (
            SELECT e, 0 AS part, n FROM jsonb_array_elements(areas) WITH ORDINALITY AS a(e, n)
            UNION ALL
            SELECT e, 1 AS part, n FROM jsonb_array_elements(sends) WITH ORDINALITY AS s(e, n)
              WHERE coalesce((e->>'lifetime')::boolean, false)) every_line ORDER BY part, n LOOP
          line_left := ${LINE_LEFT_SQL};
          IF line_left IS NULL OR line_left < amount THEN
            RETURN jsonb_build_object('admit', false, 'refusal', 'AREA', 'left', coalesce(line_left, 0), 'position', pos);
          END IF;
          pos := pos + 1;
        END LOOP;
        INSERT INTO cp_spend_holds (hold_id, job_id, obligation_id, keys, lifetime_keys, usd, held_at, what)
          VALUES (hid, hold->>'jobId', hold->>'obligationId',
            ARRAY(SELECT e->>'key' FROM jsonb_array_elements(sends || areas) WITH ORDINALITY AS t(e, n) ORDER BY n),
            ARRAY(SELECT e->>'key' FROM jsonb_array_elements(sends || areas) WITH ORDINALITY AS t(e, n)
              WHERE coalesce((e->>'lifetime')::boolean, false) ORDER BY n),
            amount, now_at, hold->>'what')
          ON CONFLICT (hold_id) DO NOTHING;
        SELECT ${spendHoldJsonSql("h")} INTO found_hold FROM cp_spend_holds h WHERE h.hold_id = hid;
        RETURN jsonb_build_object('admit', true, 'hold', found_hold);
      END $fn$;
    -- Two first bootstraps can both pass the check; the other one installed the same body.
    EXCEPTION WHEN unique_violation OR internal_error THEN NULL;
    END;
  END IF;
END $do$;`;

/** One transaction: lock the ledger row, copy its holds (existing ids kept), empty `spendHolds` and bump the revision. */
export const SPEND_HOLDS_MOVE_DDL = `DO $do$
DECLARE held jsonb;
BEGIN
  SELECT value->'spendHolds' INTO held FROM cp_budget WHERE id = 'shared-budget-ledger' FOR UPDATE;
  IF held IS NULL OR jsonb_typeof(held) <> 'object' OR held = '{}'::jsonb THEN RETURN; END IF;
  INSERT INTO cp_spend_holds (hold_id, job_id, obligation_id, keys, lifetime_keys, usd, held_at, what, settled_usd, cost_recorded_at)
  SELECT e.key, e.value->>'jobId', coalesce(e.value->>'obligationId', ''),
    ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value->'keys') = 'array' THEN e.value->'keys' ELSE '[]'::jsonb END)),
    ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value->'lifetimeKeys') = 'array' THEN e.value->'lifetimeKeys' ELSE '[]'::jsonb END)),
    (e.value->>'usd')::numeric, (e.value->>'heldAt')::timestamptz, coalesce(e.value->>'what', ''),
    CASE WHEN jsonb_typeof(e.value->'settled') = 'object' AND e.value->'settled'->>'costRecordedAt' IS NOT NULL
      THEN coalesce((e.value->'settled'->>'usd')::numeric, 0) END,
    CASE WHEN jsonb_typeof(e.value->'settled') = 'object' THEN (e.value->'settled'->>'costRecordedAt')::timestamptz END
  FROM jsonb_each(held) AS e
  WHERE jsonb_typeof(e.value) = 'object' AND e.value->>'jobId' IS NOT NULL
    AND jsonb_typeof(e.value->'usd') = 'number' AND e.value->>'heldAt' IS NOT NULL
  ON CONFLICT (hold_id) DO NOTHING;
  UPDATE cp_budget SET value = jsonb_set(value, '{spendHolds}', '{}'::jsonb), revision = revision + 1, changed_at = now()
    WHERE id = 'shared-budget-ledger';
END $do$;`;

/** Reads by kind (method knowledge, playbooks, official links) take only their rows. */
export const FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS cp_field_manual_entries_kind ON cp_field_manual_entries ((value->>'kind'));";

/** Every index the bootstrap builds online, by its DDL statement. */
export const ONLINE_INDEXES: ReadonlyMap<string, OnlineIndex> = new Map(
  [ARTIFACT_SOURCE_INDEX, ...SCOPED_HISTORY_INDEXES, ...CHANGED_AT_INDEXES, ...ROUTE_TASK_INDEXES].map(index => [index.ddl, index] as const));

export const BOOTSTRAP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_schema_version (
     singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
     version     integer NOT NULL,
     applied_at  timestamptz NOT NULL
   );`,
  /*
   * A position-allocator table rather than an advisory lock: the HTTP driver has no stable session.
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` row-locks the head row, so allocations serialize.
   */
  `CREATE TABLE IF NOT EXISTS cp_log_heads (
     log_table     text NOT NULL,
     log_key       text NOT NULL,
     next_position bigint NOT NULL,
     PRIMARY KEY (log_table, log_key)
   );`,
  `CREATE TABLE IF NOT EXISTS cp_checklist_scope_heads (
     scope_id                 text NOT NULL,
     instruction_receipt      text NOT NULL,
     projection_id            text NOT NULL,
     source_snapshot_revision bigint NOT NULL,
     snapshot_published_at    timestamptz NOT NULL,
     scope_revision           text NOT NULL,
     observed_at              timestamptz NOT NULL,
     profile                  text NOT NULL,
     inventory_complete       boolean NOT NULL,
     reads_complete           boolean NOT NULL,
     captured_counts          jsonb NOT NULL,
     PRIMARY KEY (scope_id, instruction_receipt)
   );`,
  `CREATE TABLE IF NOT EXISTS cp_checklist_instance_projections (
     projection_id  text NOT NULL,
     definition_id  text NOT NULL,
     obligation_key text NOT NULL,
     ordinal        bigint NOT NULL,
     instance       jsonb NOT NULL,
     PRIMARY KEY (projection_id, definition_id, obligation_key, ordinal)
   );`,
  ...AGGREGATE_KINDS.flatMap(aggregateTable),
  ...APPEND_ONLY_LOGS.flatMap(appendOnlyTable),
  `CREATE TABLE IF NOT EXISTS cp_admin_action_history_projection (
  gateway_receipt_id text PRIMARY KEY,
  gateway_log_key text NOT NULL DEFAULT 'admin-action' CHECK (gateway_log_key = 'admin-action'),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  gateway_type text NOT NULL,
  idempotency_key text NOT NULL,
  source_position bigint NOT NULL UNIQUE CHECK (source_position >= 0),
  source_recorded_at timestamptz NOT NULL,
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  mapping_state text NOT NULL CHECK (mapping_state IN ('MAPPED', 'SCOPE_KNOWN_KIND_UNMAPPED', 'UNMAPPED')),
  action_kind text,
  unmapped_reason text,
  target_ref text,
  target_label text,
  CONSTRAINT cp_action_history_mapping_complete CHECK (
    (mapping_state = 'MAPPED' AND action_kind IS NOT NULL AND unmapped_reason IS NULL) OR
    (mapping_state <> 'MAPPED' AND action_kind IS NULL AND unmapped_reason IS NOT NULL)
  ),
  CONSTRAINT cp_action_history_source FOREIGN KEY (gateway_log_key, gateway_receipt_id)
    REFERENCES cp_log_admin_receipts (log_key, record_id)
);`,
  `CREATE TABLE IF NOT EXISTS cp_admin_action_history_scope_ref (
  gateway_receipt_id text NOT NULL REFERENCES cp_admin_action_history_projection (gateway_receipt_id),
  scope_key text NOT NULL,
  instruction_log_key text NOT NULL DEFAULT 'admin-action' CHECK (instruction_log_key = 'admin-action'),
  instruction_receipt_id text,
  scope_kind text NOT NULL CHECK (scope_kind IN ('GLOBAL', 'INSTRUCTION')),
  PRIMARY KEY (gateway_receipt_id, scope_key),
  CONSTRAINT cp_action_history_scope_shape CHECK (
    (scope_kind = 'GLOBAL' AND scope_key = 'us' AND instruction_receipt_id IS NULL) OR
    (scope_kind = 'INSTRUCTION' AND scope_key <> 'us' AND instruction_receipt_id IS NOT NULL)
  ),
  CONSTRAINT cp_action_history_instruction_source FOREIGN KEY (instruction_log_key, instruction_receipt_id)
    REFERENCES cp_log_admin_receipts (log_key, record_id)
);`,
  `CREATE INDEX IF NOT EXISTS cp_admin_action_history_by_instruction
  ON cp_admin_action_history_scope_ref (scope_key, instruction_receipt_id, gateway_receipt_id);`,
  `CREATE INDEX IF NOT EXISTS cp_admin_action_history_by_position
  ON cp_admin_action_history_projection (source_position, gateway_receipt_id);`,
  `CREATE TABLE IF NOT EXISTS cp_admin_action_history_readiness (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  status text NOT NULL CHECK (status IN ('INCOMPLETE', 'READY')),
  source_through_position bigint NOT NULL CHECK (source_through_position >= 0),
  source_count bigint NOT NULL CHECK (source_count >= 0),
  projected_count bigint NOT NULL CHECK (projected_count >= 0),
  source_set_hash char(64) NOT NULL CHECK (source_set_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  CONSTRAINT cp_action_history_ready_counts CHECK (status <> 'READY' OR source_count = projected_count)
);`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin action history is immutable' USING ERRCODE = '23514';
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_projection_immutable' AND tgrelid = 'cp_admin_action_history_projection'::regclass) THEN
    CREATE TRIGGER cp_admin_action_history_projection_immutable
BEFORE UPDATE OR DELETE ON cp_admin_action_history_projection
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_reject_mutation();
  END IF;
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_scope_immutable' AND tgrelid = 'cp_admin_action_history_scope_ref'::regclass) THEN
    CREATE TRIGGER cp_admin_action_history_scope_immutable
BEFORE UPDATE OR DELETE ON cp_admin_action_history_scope_ref
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_reject_mutation();
  END IF;
END $$;`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_assert_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_row cp_log_admin_receipts%ROWTYPE;
  scope_count bigint;
BEGIN
  SELECT * INTO source_row FROM cp_log_admin_receipts
    WHERE log_key = NEW.gateway_log_key AND record_id = NEW.gateway_receipt_id;
  IF NOT FOUND OR source_row.position <> NEW.source_position OR
     source_row.recorded_at <> NEW.source_recorded_at OR
     source_row.record->>'receiptId' <> NEW.gateway_receipt_id OR
     source_row.record->>'type' <> NEW.gateway_type OR
     source_row.record->>'idempotencyKey' <> NEW.idempotency_key
  THEN RAISE EXCEPTION 'admin history/source receipt mismatch' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO scope_count FROM cp_admin_action_history_scope_ref
    WHERE gateway_receipt_id = NEW.gateway_receipt_id;
  IF (NEW.mapping_state = 'UNMAPPED' AND scope_count <> 0) OR
     (NEW.mapping_state <> 'UNMAPPED' AND scope_count <> 1)
  THEN RAISE EXCEPTION 'admin history scope cardinality mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_projection_parity' AND tgrelid = 'cp_admin_action_history_projection'::regclass) THEN
    CREATE CONSTRAINT TRIGGER cp_admin_action_history_projection_parity
AFTER INSERT ON cp_admin_action_history_projection DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_projection();
  END IF;
END $$;`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_assert_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  action_type text;
  projected_kind text;
  action_subject text;
  action_outcome text;
  original_subject text;
  original_type text;
  original_outcome text;
BEGIN
  SELECT p.gateway_type, p.action_kind, a.record->>'subject', a.record->>'outcome'
    INTO action_type, projected_kind, action_subject, action_outcome
    FROM cp_admin_action_history_projection p
    JOIN cp_log_admin_receipts a ON a.log_key = p.gateway_log_key AND a.record_id = p.gateway_receipt_id
    WHERE p.gateway_receipt_id = NEW.gateway_receipt_id;
  IF NEW.scope_kind = 'GLOBAL' THEN
    IF NEW.scope_key IS DISTINCT FROM 'us' OR
       ((action_type = 'runner.pause' AND projected_kind = 'global-runner-pause') OR
        (action_type = 'runner.resume' AND projected_kind = 'global-runner-resume')) IS NOT TRUE
    THEN RAISE EXCEPTION 'unproven global action scope' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT record->>'subject', record->>'type', record->>'outcome'
      INTO original_subject, original_type, original_outcome
      FROM cp_log_admin_receipts WHERE log_key = 'admin-action' AND record_id = NEW.instruction_receipt_id;
    IF action_type IS DISTINCT FROM 'expansion.scope.set' OR projected_kind IS NOT NULL OR
       action_subject IS DISTINCT FROM NEW.scope_key OR action_outcome IS DISTINCT FROM 'DONE' OR
       original_type IS DISTINCT FROM 'expansion.scope.set' OR
       original_subject IS DISTINCT FROM NEW.scope_key OR original_outcome IS DISTINCT FROM 'DONE'
    THEN RAISE EXCEPTION 'unproven instruction action scope' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_scope_parity' AND tgrelid = 'cp_admin_action_history_scope_ref'::regclass) THEN
    CREATE CONSTRAINT TRIGGER cp_admin_action_history_scope_parity
AFTER INSERT ON cp_admin_action_history_scope_ref DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_scope();
  END IF;
END $$;`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_invalidate_readiness() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.log_key <> 'admin-action' THEN RETURN NEW; END IF;
  UPDATE cp_admin_action_history_readiness SET status = 'INCOMPLETE'
    WHERE singleton = true AND status = 'READY';
  RETURN NEW;
END $$;`,
  `DO $$ BEGIN
  DROP TRIGGER IF EXISTS cp_admin_action_history_receipt_companion ON cp_log_admin_receipts;
  DROP FUNCTION IF EXISTS cp_admin_action_history_assert_receipt();
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_receipt_invalidation' AND tgrelid = 'cp_log_admin_receipts'::regclass) THEN
    CREATE CONSTRAINT TRIGGER cp_admin_action_history_receipt_invalidation
AFTER INSERT ON cp_log_admin_receipts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_invalidate_readiness();
  END IF;
END $$;`,
  // Bootstrap executes one standalone statement per query, outside a transaction.
  // CONCURRENTLY lets the standing runner keep appending while this index is built.
  // URLs can exceed the btree row limit; the query also checks exact equality.
  ARTIFACT_SOURCE_INDEX_DDL,
  `CREATE INDEX IF NOT EXISTS cp_attempts_lease_id ON cp_attempts ((value->>'leaseId'));`,
  `CREATE INDEX IF NOT EXISTS cp_log_owner_digests_cycle_kind_position
     ON cp_log_owner_digests (log_key, (record #>> '{runtimeOutcome,kind}'), position DESC);`,
  `CREATE INDEX IF NOT EXISTS cp_route_tasks_state
     ON cp_route_tasks ((value->>'state'));`,
  `CREATE INDEX IF NOT EXISTS cp_leases_expiry
     ON cp_leases ((value->>'expiresAt'));`,
  /* Due-time index: "which obligations are due?" is a range scan. */
  `CREATE INDEX IF NOT EXISTS cp_obligations_next_due
     ON cp_obligations ((value->>'nextDueAt'))
     WHERE (value->>'active')::boolean;`,
  `CREATE INDEX IF NOT EXISTS cp_debts_retry
     ON cp_debts ((value->>'retryAt'));`,
  `CREATE INDEX IF NOT EXISTS cp_occurrences_obligation
     ON cp_occurrences ((value->>'obligationId'));`,
  ...SCOPED_HISTORY_INDEXES.map(index => index.ddl),
  CHANGED_AT_TOUCH_FUNCTION_DDL,
  ...CHANGED_AT_TABLES.map(changedAtColumnDdl),
  REJECT_REWRITE_FUNCTION_DDL,
  ...CHANGED_AT_TABLES.map(rejectRewriteDdl),
  ...CHANGED_AT_INDEXES.map(index => index.ddl),
  ...ROUTE_TASK_INDEXES.map(index => index.ddl),
  SPEND_HOLDS_TABLE_DDL,
  SPEND_HOLDS_INDEXES_DDL,
  ADMIT_SPEND_HOLD_FUNCTION_DDL,
  SPEND_HOLDS_MOVE_DDL,
  VITAL_SIGNS_TABLE_DDL,
  ...FIX_MAP_DDL,
  ...WEBSITE_PACING_DDL,
  FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL,
];

/** Run before the unique index is created, so a duplicate is reported by log and position. */
export function duplicatePositionQuery(log: string): string {
  return `SELECT log_key, position, count(*) AS n
          FROM cp_log_${log}
          GROUP BY log_key, position
          HAVING count(*) > 1`;
}

/** The statement that records which version the database is now at. */
export function recordVersionStatement(version: number, nowIso: string): string {
  return `INSERT INTO cp_schema_version (singleton, version, applied_at)
          VALUES (true, ${version}, '${nowIso}')
          ON CONFLICT (singleton) DO UPDATE
            SET version = GREATEST(cp_schema_version.version, EXCLUDED.version),
                applied_at = CASE WHEN EXCLUDED.version >= cp_schema_version.version THEN EXCLUDED.applied_at ELSE cp_schema_version.applied_at END;`;
}

/** What the gate found, and every field is a fact it read rather than assumed. */
export interface SchemaVerdict {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly appliedVersion: number | null;
  readonly expectedVersion: number;
  readonly missingTables: readonly string[];
  readonly unexpectedTables: readonly string[];
  readonly problems: readonly string[];
}

/** Pure. An unreachable database is not a pass. */
export function judgeSchema(input: {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly appliedVersion: number | null;
  readonly liveTables: readonly string[] | null;
  readonly unreachableReason?: string;
}): SchemaVerdict {
  const problems: string[] = [];

  if (!input.configured) {
    return {
      configured: false,
      reachable: false,
      appliedVersion: null,
      expectedVersion: BOOTSTRAP_VERSION,
      missingTables: [],
      unexpectedTables: [],
      problems: [],
    };
  }

  if (!input.reachable || input.liveTables === null) {
    return {
      configured: true,
      reachable: false,
      appliedVersion: null,
      expectedVersion: BOOTSTRAP_VERSION,
      missingTables: [],
      unexpectedTables: [],
      problems: [
        `the control-plane database is configured and could not be reached: ${
          input.unreachableReason ?? "no reason given"
        }. A gate that read this as "nothing wrong" would go green on a database that does not ` +
          "exist, which is the shape of an unenforced check.",
      ],
    };
  }

  const live = new Set(input.liveTables);
  const missingTables = DECLARED_TABLES.filter((t) => !live.has(t));
  /* Only `cp_`-prefixed tables are judged. */
  const unexpectedTables = [...live].filter(
    (t) => t.startsWith("cp_") && !DECLARED_TABLES.includes(t),
  );

  if (missingTables.length > 0) {
    problems.push(
      `${missingTables.length} declared table(s) are absent: ${missingTables.join(", ")}. The ` +
        "bootstrap is idempotent and runs on connect, so an absent table means no provider has " +
        "connected to this database yet, or something dropped it.",
    );
  }
  if (unexpectedTables.length > 0) {
    problems.push(
      `${unexpectedTables.length} control-plane table(s) exist that this module does not ` +
        `declare: ${unexpectedTables.join(", ")}. Schema is owned by the provider module; a ` +
        "table nobody declared is a hand edit, and a hand edit nobody can see is how a schema " +
        "stops being what its code says it is.",
    );
  }
  if (input.appliedVersion === null) {
    problems.push(
      "the database records no schema version. It cannot be placed against " +
        `BOOTSTRAP_VERSION ${BOOTSTRAP_VERSION}, and an unplaceable schema is not a current one.`,
    );
  } else if (input.appliedVersion !== BOOTSTRAP_VERSION) {
    problems.push(
      `the database is at schema version ${input.appliedVersion} and this module declares ` +
        `${BOOTSTRAP_VERSION}. Connect a provider to bring it up, or the code and the database ` +
        "are two different schemas.",
    );
  }

  return {
    configured: true,
    reachable: true,
    appliedVersion: input.appliedVersion,
    expectedVersion: BOOTSTRAP_VERSION,
    missingTables,
    unexpectedTables,
    problems,
  };
}
