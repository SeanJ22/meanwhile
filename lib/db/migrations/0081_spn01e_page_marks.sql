ALTER TABLE place_page ALTER COLUMN body DROP NOT NULL,
  ADD COLUMN stale_at timestamptz,
  ADD COLUMN lease_token text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN priority integer NOT NULL DEFAULT 0,
  ADD COLUMN depends text[];
--> statement-breakpoint
CREATE INDEX place_page_stale ON place_page(priority DESC, stale_at, place_id) WHERE stale_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX place_page_depends ON place_page USING gin(depends) WHERE depends IS NOT NULL;
