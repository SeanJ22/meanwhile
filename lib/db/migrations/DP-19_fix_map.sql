CREATE TABLE IF NOT EXISTS cp_fix_map (
  method_id text NOT NULL,
  place_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('WORKS', 'FAILS', 'UNTRIED')),
  tried_at timestamptz,
  attempt_id text,
  cause text,
  updated_at timestamptz NOT NULL,
  superseded_attempt_id text,
  PRIMARY KEY (method_id, place_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cp_fix_map_place ON cp_fix_map (place_id, method_id);
