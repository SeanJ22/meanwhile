CREATE TABLE place_slice (
  place_id text NOT NULL,
  card text NOT NULL CHECK (card IN ('governs','bodies','ballot','money','more')),
  body jsonb,
  fingerprint text NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (place_id, card)
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly') THEN
    GRANT SELECT ON place_slice TO readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN
    GRANT SELECT ON place_slice TO wtp_cp_release_readonly;
  END IF;
END $$;
