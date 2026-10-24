ALTER TABLE entity_place ADD COLUMN boundary_year integer;
--> statement-breakpoint
ALTER TABLE entity_place ADD COLUMN placement_basis text NOT NULL DEFAULT 'SERVICE_AREA';
