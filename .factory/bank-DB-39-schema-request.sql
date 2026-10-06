-- REQUEST TO RIVER, NOT AN APPLIED MIGRATION.
-- Target CONTROL-PLANE DB only; number/apply through its authorized bootstrap.
CREATE TABLE IF NOT EXISTS cp_field_manual_entries (
 id text PRIMARY KEY,
 value jsonb NOT NULL,
 role text NOT NULL,
 kind text NOT NULL,
 states text[] NOT NULL DEFAULT '{}',
 platforms text[] NOT NULL DEFAULT '{}',
 record_classes text[] NOT NULL DEFAULT '{}',
 outcome text NOT NULL,
 ocd_ids text[] NOT NULL DEFAULT '{}',
 body_ids text[] NOT NULL DEFAULT '{}',
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_kind_idx ON cp_field_manual_entries(kind);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_outcome_idx ON cp_field_manual_entries(outcome);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_role_idx ON cp_field_manual_entries(role);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_states_idx ON cp_field_manual_entries USING gin(states);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_platforms_idx ON cp_field_manual_entries USING gin(platforms);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_classes_idx ON cp_field_manual_entries USING gin(record_classes);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_ocd_idx ON cp_field_manual_entries USING gin(ocd_ids);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_bodies_idx ON cp_field_manual_entries USING gin(body_ids);
CREATE INDEX IF NOT EXISTS cp_field_manual_entries_cost_key_idx ON cp_field_manual_entries
 (((value->'payload'->>'platform') || ':' || (value->'payload'->>'recordClass'))) WHERE kind = 'JOB_COST';
-- Backfill via Bank normalizeEntry(entry), preserving original payload and every id.
-- Stop Bank writers for the cutover (runner currently already stopped).
-- Verify entry ids/payloads and representative scoped briefs against preserved
-- cp_field_manual/live BEFORE selecting row storage. Never drop the old row:
-- keep a read-only checkpoint; no runtime fallback/dual writes after activation.
-- write-errors remains its tiny, separately keyed aggregate (Admin reads it).
