ALTER TABLE zip_place ALTER COLUMN share DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE zcta_place ALTER COLUMN share DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE zip_place DROP CONSTRAINT zip_place_share_check,
  ADD CONSTRAINT zip_place_share_check CHECK (share>=0 AND share<=1);
--> statement-breakpoint
ALTER TABLE zcta_place DROP CONSTRAINT zcta_place_share_check,
  ADD CONSTRAINT zcta_place_share_check CHECK (share>=0 AND share<=1);
--> statement-breakpoint
CREATE TABLE "place_boundary" (
  "place_id" text NOT NULL REFERENCES entity(id),
  "boundary_year" integer NOT NULL,
  "layer" text NOT NULL,
  "version" text NOT NULL,
  "geometry" jsonb,
  "bounds" box,
  "host_county_id" text REFERENCES entity(id),
  "county_attachment" boolean NOT NULL DEFAULT false,
  "source_urls" jsonb NOT NULL DEFAULT '[]',
  "checked_at" timestamptz NOT NULL,
  PRIMARY KEY (place_id, boundary_year),
  CHECK ((geometry IS NULL) = (bounds IS NULL)),
  CHECK (NOT county_attachment OR (host_county_id IS NOT NULL AND geometry IS NULL))
);
--> statement-breakpoint
CREATE INDEX "place_boundary_point_idx" ON place_boundary USING gist (bounds);
--> statement-breakpoint
CREATE INDEX "place_boundary_host_idx" ON place_boundary (host_county_id) WHERE county_attachment;
--> statement-breakpoint
ALTER TABLE zip_place ADD COLUMN partial boolean NOT NULL DEFAULT true,
  ADD COLUMN fringe boolean NOT NULL DEFAULT false,
  ADD COLUMN share_basis text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE zcta_place ADD COLUMN partial boolean NOT NULL DEFAULT true,
  ADD COLUMN fringe boolean NOT NULL DEFAULT false,
  ADD COLUMN share_basis text NOT NULL DEFAULT 'unknown';
