CREATE FUNCTION count_legistar_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF starts_with(NEW.subject_id,'legistar-members:') THEN
    IF TG_OP='INSERT' THEN PERFORM count_hour_add(NEW.state,'Legistar members','rows in',0,1,0); END IF;
    IF TG_OP='UPDATE' THEN
      IF cardinality(NEW.done_times)>cardinality(OLD.done_times) THEN PERFORM count_hour_add(NEW.state,'Legistar members','done',0,1,1); END IF;
      IF cardinality(NEW.refused_times)>cardinality(OLD.refused_times) THEN PERFORM count_hour_add(NEW.state,'Legistar members','refused',0,1,1); END IF;
      IF NEW.content_version<>OLD.content_version THEN PERFORM count_hour_add(NEW.state,'Legistar members','rows in',0,1,0); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER count_legistar_work AFTER INSERT OR UPDATE ON work_row FOR EACH ROW EXECUTE FUNCTION count_legistar_work();
