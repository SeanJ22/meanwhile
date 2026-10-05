-- BX-01 shared-owner hook proposal, not an applied migration.
-- River: include box_findings in AGGREGATE_KINDS, assign the schema version
-- and migration identity, and apply via the existing control-plane path.
-- This belongs to WTP_CONTROL_PLANE_DATABASE_URL, not the serving database.
CREATE TABLE IF NOT EXISTS cp_box_findings (
  id text PRIMARY KEY,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  value jsonb NOT NULL
);
