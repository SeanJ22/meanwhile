ALTER TABLE rebuild_queue
  ADD COLUMN generation bigint NOT NULL DEFAULT 1,
  ADD COLUMN built_generation bigint,
  ADD COLUMN next_queued_at timestamptz,
  ADD COLUMN lease_token text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN lease_slot smallint CHECK (lease_slot BETWEEN 1 AND 4);
--> statement-breakpoint
CREATE UNIQUE INDEX rebuild_queue_lease_slot ON rebuild_queue(lease_slot) WHERE lease_token IS NOT NULL;
--> statement-breakpoint
CREATE INDEX rebuild_queue_ready ON rebuild_queue(queued_at,place_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS place_page (
  place_id text PRIMARY KEY REFERENCES entity(id),
  version bigint NOT NULL DEFAULT 1,
  built_at timestamptz NOT NULL DEFAULT now(),
  body jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE place_page
  ADD COLUMN history_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE TABLE place_page_dependency (
  page_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  entity_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  PRIMARY KEY(page_id,entity_id)
);
--> statement-breakpoint
CREATE INDEX place_page_dependency_entity ON place_page_dependency(entity_id,page_id);
