-- CP-01 current publication status.
CREATE TABLE IF NOT EXISTS civic_data_source_status (
    source_id text NOT NULL,record_class text NOT NULL,scope text NOT NULL,candidate_id text NOT NULL,
    state text NOT NULL,failure_code text,attempted_at timestamptz NOT NULL,
    PRIMARY KEY(source_id,record_class,scope));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS civic_data_source_status_candidate ON civic_data_source_status(candidate_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS civic_data_current_readbacks (
    pointer_key text NOT NULL,contract_id text NOT NULL,candidate_id text NOT NULL,at timestamptz NOT NULL,
    status text NOT NULL CHECK(status IN ('PASS','FAIL')),PRIMARY KEY(pointer_key,contract_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS civic_data_source_status_ready(id boolean PRIMARY KEY CHECK(id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_refresh_source_status(source_key text,record_kind text,scope_key text) RETURNS void
  LANGUAGE plpgsql AS $$ BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('civic-source-status:'||source_key),hashtext(record_kind||':'||scope_key));
    DELETE FROM civic_data_source_status WHERE source_id=source_key AND record_class=record_kind AND scope=scope_key;
    INSERT INTO civic_data_source_status(source_id,record_class,scope,candidate_id,state,failure_code,attempted_at)
    WITH events AS (
      SELECT c.id AS candidate_id,c.source_id,c.record_class,c.scope,c.state,c.failure_code,e.state AS event_state,e.at,e.detail
      FROM civic_data_candidates c JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence=1
      WHERE c.source_id=source_key AND c.record_class=record_kind AND c.scope=scope_key
      UNION ALL
      SELECT c.id,c.source_id,c.record_class,c.scope,c.state,c.failure_code,e.state,e.at,e.detail
      FROM civic_data_candidates c JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence<>1
      WHERE c.source_id=source_key AND c.record_class=record_kind AND c.scope=scope_key
        AND e.state='PROMOTED' AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 '
        AND EXISTS(SELECT 1 FROM civic_data_promotions p WHERE p.current_version_id=c.id)
    ), typed AS MATERIALIZED (
      SELECT candidate_id,source_id,record_class,scope,state,failure_code,at,CASE WHEN event_state='PROMOTED' AND left(detail,26)='UNCHANGED_CONFIRMATION_V1 '
        AND pg_input_is_valid(substring(detail FROM 27),'jsonb')
        THEN substring(detail FROM 27)::jsonb #>> '{retrieval,sourceCheck,checkedAt}' END AS source_at FROM events
    ) SELECT source_id,record_class,scope,candidate_id,state,failure_code,
      CASE WHEN pg_input_is_valid(source_at,'timestamp with time zone') THEN source_at::timestamptz ELSE at END AS attempted_at
      FROM typed ORDER BY attempted_at DESC,candidate_id DESC LIMIT 1;
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_refresh_current_readbacks(pointer text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('civic-current-readback'),hashtext(pointer));
    DELETE FROM civic_data_current_readbacks WHERE pointer_key=pointer;
    INSERT INTO civic_data_current_readbacks(pointer_key,contract_id,candidate_id,at,status)
      WITH typed AS MATERIALIZED (
        SELECT p.key,p.current_version_id,e.at,e.sequence,
          CASE WHEN pg_input_is_valid(substring(e.detail FROM 31),'jsonb')
            THEN substring(e.detail FROM 31)::jsonb END AS r
        FROM civic_data_promotions p JOIN civic_data_candidate_events e ON e.candidate_id=p.current_version_id
        WHERE p.key=pointer AND left(e.detail,30)='READER_PROJECTION_READBACK_V2 '
      ) SELECT DISTINCT ON (r->>'contractId') key,r->>'contractId',current_version_id,at,r->>'status'
        FROM typed WHERE jsonb_typeof(r)='object' AND r->'contractVersion'='2'::jsonb AND r->>'kind'='READER_PROJECTION_READBACK'
  AND jsonb_typeof(r->'contractId')='string' AND length(r->>'contractId')>0 AND jsonb_typeof(r->'sourceId')='string' AND length(r->>'sourceId')>0 AND jsonb_typeof(r->'recordClass')='string' AND length(r->>'recordClass')>0 AND jsonb_typeof(r->'scope')='string' AND length(r->>'scope')>0 AND jsonb_typeof(r->'projectionId')='string' AND length(r->>'projectionId')>0 AND jsonb_typeof(r->'versionId')='string' AND length(r->>'versionId')>0 AND jsonb_typeof(r->'observedAt')='string' AND length(r->>'observedAt')>0 AND jsonb_typeof(r->'verifierId')='string' AND length(r->>'verifierId')>0 AND jsonb_typeof(r->'detail')='string' AND length(r->>'detail')>0
  AND r->>'recordClass'=ANY(ARRAY['FEC_FUNDING','STATE_CAMPAIGN_FINANCE','LOCAL_CAMPAIGN_FINANCE','STATE_LEGISLATOR','STATE_ROLL_CALL','STATE_LEGISLATOR_VOTES','STATE_BILL','FEDERAL_ROLL_CALL','FEDERAL_KEY_VOTE','FEDERAL_DIRECTORY','FEDERAL_CIVIC_RECORD','REGISTRY_RUNTIME_BINDING','VOTING_SITE','GOOGLE_CIVIC_VOTERINFO','PRL_PROFILE','PRL_ARCHIVE','CENSUS_REFERENCE','CENSUS_GEOGRAPHY','MEETING','BALLOT_CANDIDACY','CANDIDATE_PROFILE','CANDIDATE_PUBLICATION','OFFICEHOLDER_STATEMENT','STATE_EXECUTIVE_ACTION','MEETING_OUTCOME','CURATED_READER_RECORD','DOTGOV_REFERENCE','OPERATIONAL_REFERENCE','REGISTRATION','FEDERAL_MONEY','CAMPAIGN_FINANCE'])
  AND r->>'pointerKey'=(r->>'recordClass')||':'||(r->>'scope')
  AND pg_input_is_valid(r->>'observedAt','timestamp with time zone')
  AND r->>'evidenceKind' IN ('WRITE_CONTENT_FINGERPRINT','TYPED_READER_READ_MODEL')
  AND r ? 'verifierCodeSha' AND (r->'verifierCodeSha'='null'::jsonb OR
    (jsonb_typeof(r->'verifierCodeSha')='string' AND r->>'verifierCodeSha' ~ '^[0-9a-f]{40}$'))
  AND r->>'status' IN ('PASS','FAIL') AND r->>'versionId'=current_version_id
        ORDER BY r->>'contractId',at DESC,sequence ASC;
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_source_status_event() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE candidate_key text; meta record; pointer record; BEGIN
    FOR candidate_key IN SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP<>'INSERT' THEN OLD.candidate_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.candidate_id END]) AS ids(id) WHERE id IS NOT NULL LOOP
    IF (TG_OP<>'DELETE' AND (NEW.sequence=1 OR (NEW.state='PROMOTED' AND left(NEW.detail,26)='UNCHANGED_CONFIRMATION_V1 ')))
      OR (TG_OP<>'INSERT' AND (OLD.sequence=1 OR (OLD.state='PROMOTED' AND left(OLD.detail,26)='UNCHANGED_CONFIRMATION_V1 '))) THEN
      SELECT source_id,record_class,scope INTO meta FROM civic_data_candidates WHERE id=candidate_key;
      IF FOUND THEN PERFORM civic_refresh_source_status(meta.source_id,meta.record_class,meta.scope); END IF;
    END IF;
    IF (TG_OP<>'DELETE' AND left(NEW.detail,30)='READER_PROJECTION_READBACK_V2 ')
      OR (TG_OP<>'INSERT' AND left(OLD.detail,30)='READER_PROJECTION_READBACK_V2 ') THEN
      FOR pointer IN SELECT key FROM civic_data_promotions WHERE current_version_id=candidate_key LOOP
        PERFORM civic_refresh_current_readbacks(pointer.key);
      END LOOP;
    END IF;
    END LOOP;
    RETURN coalesce(NEW,OLD);
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_source_status_candidate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='UPDATE' AND (NEW.source_id,NEW.record_class,NEW.scope) IS NOT DISTINCT FROM (OLD.source_id,OLD.record_class,OLD.scope) THEN
      UPDATE civic_data_source_status SET state=NEW.state,failure_code=NEW.failure_code WHERE candidate_id=NEW.id;
      RETURN NEW;
    END IF;
    PERFORM civic_refresh_source_status(OLD.source_id,OLD.record_class,OLD.scope);
    IF TG_OP='UPDATE' THEN PERFORM civic_refresh_source_status(NEW.source_id,NEW.record_class,NEW.scope); END IF;
    RETURN coalesce(NEW,OLD);
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_source_status_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='UPDATE' AND (OLD.key,OLD.source_id,OLD.record_class,OLD.scope,OLD.current_version_id)
      IS NOT DISTINCT FROM (NEW.key,NEW.source_id,NEW.record_class,NEW.scope,NEW.current_version_id) THEN RETURN NEW; END IF;
    IF TG_OP<>'INSERT' AND (TG_OP='DELETE' OR (OLD.source_id,OLD.record_class,OLD.scope) IS DISTINCT FROM (NEW.source_id,NEW.record_class,NEW.scope)) THEN
      PERFORM civic_refresh_source_status(OLD.source_id,OLD.record_class,OLD.scope);
    END IF;
    IF TG_OP<>'INSERT' AND (TG_OP='DELETE' OR OLD.key IS DISTINCT FROM NEW.key) THEN
      PERFORM civic_refresh_current_readbacks(OLD.key);
    END IF;
    IF TG_OP<>'DELETE' THEN
      PERFORM civic_refresh_source_status(NEW.source_id,NEW.record_class,NEW.scope);
      PERFORM civic_refresh_current_readbacks(NEW.key);
    END IF;
    RETURN coalesce(NEW,OLD);
  END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='civic_source_status_event' AND tgrelid='civic_data_candidate_events'::regclass) THEN
      CREATE TRIGGER civic_source_status_event AFTER INSERT OR UPDATE OR DELETE ON civic_data_candidate_events FOR EACH ROW EXECUTE FUNCTION civic_source_status_event(); END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='civic_source_status_candidate' AND tgrelid='civic_data_candidates'::regclass) THEN
      CREATE TRIGGER civic_source_status_candidate AFTER UPDATE OR DELETE ON civic_data_candidates FOR EACH ROW EXECUTE FUNCTION civic_source_status_candidate(); END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='civic_source_status_pointer' AND tgrelid='civic_data_promotions'::regclass) THEN
      CREATE TRIGGER civic_source_status_pointer AFTER INSERT OR UPDATE OR DELETE ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION civic_source_status_pointer(); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='readonly') THEN GRANT SELECT ON civic_data_source_status,civic_data_current_readbacks TO readonly; END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN GRANT SELECT ON civic_data_source_status,civic_data_current_readbacks TO wtp_cp_release_readonly; END IF;
  END $$;
--> statement-breakpoint
-- CP-01 source status backfill begins.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM civic_data_source_status_ready WHERE id=true) THEN
    LOCK TABLE civic_data_candidates,civic_data_candidate_events,civic_data_promotions IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM civic_data_source_status;
    INSERT INTO civic_data_source_status(source_id,record_class,scope,candidate_id,state,failure_code,attempted_at)
    WITH events AS (
      SELECT c.id AS candidate_id,c.source_id,c.record_class,c.scope,c.state,c.failure_code,e.state AS event_state,e.at,e.detail
      FROM civic_data_candidates c JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence=1
      UNION ALL
      SELECT c.id,c.source_id,c.record_class,c.scope,c.state,c.failure_code,e.state,e.at,e.detail
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence<>1
      WHERE e.state='PROMOTED' AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 '
    ), typed AS MATERIALIZED (
      SELECT candidate_id,source_id,record_class,scope,state,failure_code,at,CASE WHEN event_state='PROMOTED' AND left(detail,26)='UNCHANGED_CONFIRMATION_V1 '
        AND pg_input_is_valid(substring(detail FROM 27),'jsonb')
        THEN substring(detail FROM 27)::jsonb #>> '{retrieval,sourceCheck,checkedAt}' END AS source_at FROM events
    ), stamped AS (
      SELECT source_id,record_class,scope,candidate_id,state,failure_code,
        CASE WHEN pg_input_is_valid(source_at,'timestamp with time zone') THEN source_at::timestamptz ELSE at END AS attempted_at FROM typed
    ) SELECT DISTINCT ON(source_id,record_class,scope) source_id,record_class,scope,candidate_id,state,failure_code,attempted_at
      FROM stamped ORDER BY source_id,record_class,scope,attempted_at DESC,candidate_id DESC;
    DELETE FROM civic_data_current_readbacks;
    INSERT INTO civic_data_current_readbacks(pointer_key,contract_id,candidate_id,at,status)
    WITH typed AS MATERIALIZED (
      SELECT p.key,p.current_version_id,e.at,e.sequence,
        CASE WHEN pg_input_is_valid(substring(e.detail FROM 31),'jsonb')
          THEN substring(e.detail FROM 31)::jsonb END AS r
      FROM civic_data_promotions p JOIN civic_data_candidate_events e ON e.candidate_id=p.current_version_id
      WHERE left(e.detail,30)='READER_PROJECTION_READBACK_V2 '
    ) SELECT DISTINCT ON(key,r->>'contractId') key,r->>'contractId',current_version_id,at,r->>'status'
      FROM typed WHERE jsonb_typeof(r)='object' AND r->'contractVersion'='2'::jsonb AND r->>'kind'='READER_PROJECTION_READBACK'
  AND jsonb_typeof(r->'contractId')='string' AND length(r->>'contractId')>0 AND jsonb_typeof(r->'sourceId')='string' AND length(r->>'sourceId')>0 AND jsonb_typeof(r->'recordClass')='string' AND length(r->>'recordClass')>0 AND jsonb_typeof(r->'scope')='string' AND length(r->>'scope')>0 AND jsonb_typeof(r->'projectionId')='string' AND length(r->>'projectionId')>0 AND jsonb_typeof(r->'versionId')='string' AND length(r->>'versionId')>0 AND jsonb_typeof(r->'observedAt')='string' AND length(r->>'observedAt')>0 AND jsonb_typeof(r->'verifierId')='string' AND length(r->>'verifierId')>0 AND jsonb_typeof(r->'detail')='string' AND length(r->>'detail')>0
  AND r->>'recordClass'=ANY(ARRAY['FEC_FUNDING','STATE_CAMPAIGN_FINANCE','LOCAL_CAMPAIGN_FINANCE','STATE_LEGISLATOR','STATE_ROLL_CALL','STATE_LEGISLATOR_VOTES','STATE_BILL','FEDERAL_ROLL_CALL','FEDERAL_KEY_VOTE','FEDERAL_DIRECTORY','FEDERAL_CIVIC_RECORD','REGISTRY_RUNTIME_BINDING','VOTING_SITE','GOOGLE_CIVIC_VOTERINFO','PRL_PROFILE','PRL_ARCHIVE','CENSUS_REFERENCE','CENSUS_GEOGRAPHY','MEETING','BALLOT_CANDIDACY','CANDIDATE_PROFILE','CANDIDATE_PUBLICATION','OFFICEHOLDER_STATEMENT','STATE_EXECUTIVE_ACTION','MEETING_OUTCOME','CURATED_READER_RECORD','DOTGOV_REFERENCE','OPERATIONAL_REFERENCE','REGISTRATION','FEDERAL_MONEY','CAMPAIGN_FINANCE'])
  AND r->>'pointerKey'=(r->>'recordClass')||':'||(r->>'scope')
  AND pg_input_is_valid(r->>'observedAt','timestamp with time zone')
  AND r->>'evidenceKind' IN ('WRITE_CONTENT_FINGERPRINT','TYPED_READER_READ_MODEL')
  AND r ? 'verifierCodeSha' AND (r->'verifierCodeSha'='null'::jsonb OR
    (jsonb_typeof(r->'verifierCodeSha')='string' AND r->>'verifierCodeSha' ~ '^[0-9a-f]{40}$'))
  AND r->>'status' IN ('PASS','FAIL') AND r->>'versionId'=current_version_id
      ORDER BY key,r->>'contractId',at DESC,sequence ASC;
    INSERT INTO civic_data_source_status_ready VALUES(true);
  END IF;
END $$;
