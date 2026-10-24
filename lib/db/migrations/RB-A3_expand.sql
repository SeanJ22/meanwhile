CREATE TABLE IF NOT EXISTS rebuild_queue (
  place_id text PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS count_hour (
  state char(2) NOT NULL,
  hour timestamptz NOT NULL,
  step text NOT NULL,
  n bigint NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (state, hour, step)
);
