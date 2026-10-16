CREATE INDEX fact_member_lookup ON fact (field) INCLUDE (entity_id, status) WHERE field LIKE 'member:%';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fact_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'live' AND (TG_OP = 'INSERT' OR OLD.status <> 'live') THEN RETURN NULL; END IF;
  INSERT INTO fact_watermark (scope, version)
    SELECT scope, 1 FROM unnest(ARRAY[(SELECT state FROM entity WHERE id = NEW.entity_id), CASE WHEN NEW.field LIKE 'comment:%' THEN 'comment' END]) AS scope
    WHERE scope IS NOT NULL
    ON CONFLICT (scope) DO UPDATE SET version = fact_watermark.version + 1;
  INSERT INTO rebuild_queue (place_id, queued_at)
    WITH memberships AS MATERIALIZED (
      SELECT entity_id, status FROM fact WHERE field = 'member:' || NEW.entity_id AND field LIKE 'member:%'
    ) SELECT DISTINCT place, statement_timestamp() FROM (
      SELECT b.id FROM entity b WHERE b.id = NEW.entity_id AND b.kind = 'body'
      UNION SELECT s.parent_id FROM entity s WHERE s.id = NEW.entity_id AND s.kind = 'meeting' AND s.parent_id IS NOT NULL
      UNION SELECT entity_id FROM memberships WHERE status = 'live'
    ) bodies(id)
    CROSS JOIN LATERAL (SELECT p.place_id FROM entity_place p WHERE p.entity_id = bodies.id
      UNION SELECT split_part(bodies.id, '#', 1) WHERE bodies.id LIKE 'ocd-division/%#%') places(place)
    ON CONFLICT (place_id) DO UPDATE SET queued_at = EXCLUDED.queued_at;
  RETURN NULL;
END $$;
