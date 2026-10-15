CREATE TABLE "fact_watermark" (
  "scope" text PRIMARY KEY NOT NULL,
  "version" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pass_cursor" (
  "name" text PRIMARY KEY NOT NULL,
  "position" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fact_live_member" ON "fact" ("field") WHERE "status" = 'live' AND "field" LIKE 'member:%';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fact_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'live' AND (TG_OP = 'INSERT' OR OLD.status <> 'live') THEN RETURN NULL; END IF;
  INSERT INTO fact_watermark (scope, version)
    SELECT scope, 1 FROM unnest(ARRAY[(SELECT state FROM entity WHERE id = NEW.entity_id),
      CASE WHEN NEW.entity_id LIKE 'meeting:%' THEN 'meeting' END, CASE WHEN NEW.field LIKE 'comment:%' THEN 'comment' END]) AS scope
    WHERE scope IS NOT NULL
    ON CONFLICT (scope) DO UPDATE SET version = fact_watermark.version + 1;
  -- A body's change queues its places and its own division; a person's queues those of each body they sit on.
  INSERT INTO rebuild_queue (place_id, queued_at)
    SELECT DISTINCT place, clock_timestamp() FROM (
      SELECT b.id FROM entity b WHERE b.id = NEW.entity_id AND b.kind = 'body'
      UNION SELECT m.entity_id FROM fact m WHERE m.status = 'live' AND m.field LIKE 'member:%' AND m.field = 'member:' || NEW.entity_id
    ) bodies(id)
    CROSS JOIN LATERAL (SELECT p.place_id FROM entity_place p WHERE p.entity_id = bodies.id
      UNION SELECT split_part(bodies.id, '#', 1) WHERE bodies.id LIKE 'ocd-division/%#%') places(place)
    ON CONFLICT (place_id) DO UPDATE SET queued_at = EXCLUDED.queued_at;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER fact_changed AFTER INSERT OR UPDATE OF status ON fact FOR EACH ROW EXECUTE FUNCTION fact_changed();
--> statement-breakpoint
INSERT INTO fact_watermark (scope, version) SELECT DISTINCT e.state, 1 FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.state IS NOT NULL
  ON CONFLICT (scope) DO NOTHING;
