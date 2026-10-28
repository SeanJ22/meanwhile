CREATE INDEX rebuild_queue_source_updates ON rebuild_queue ((next_queued_at IS NOT NULL) DESC,
  (next_queued_at IS NOT NULL AND place_id LIKE 'ocd-division/%' AND place_id NOT LIKE '%#%') DESC,
  (next_queued_at IS NOT NULL AND place_id NOT LIKE 'zip:%') DESC,next_queued_at DESC NULLS LAST,queued_at,place_id);
--> statement-breakpoint
CREATE FUNCTION count_legistar_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE region text;
BEGIN
  IF starts_with(NEW.produced_by,'legistar-members:') THEN
    SELECT state INTO region FROM entity WHERE id=NEW.entity_id;
    IF TG_OP='INSERT' AND NEW.status='live' THEN
      PERFORM count_hour_add(coalesce(region,'US'),'Legistar members','published',0,1,1);
    ELSIF TG_OP='UPDATE' AND OLD.status='live' AND NEW.status='superseded' THEN
      PERFORM count_hour_add(coalesce(region,'US'),'Legistar members','retired',0,1,1);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER count_legistar_fact AFTER INSERT OR UPDATE ON fact FOR EACH ROW EXECUTE FUNCTION count_legistar_fact();
