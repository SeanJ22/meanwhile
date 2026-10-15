CREATE OR REPLACE FUNCTION cp_cost_recorded_at(entry jsonb) RETURNS timestamptz
    LANGUAGE sql IMMUTABLE SET timezone='UTC' AS $$ SELECT (entry->>'recordedAt')::timestamptz $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_cost_record_id(entry jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT 'ce-' || substr(encode(sha256(convert_to(entry->>'attemptId','UTF8') || decode('1f','hex') ||
      coalesce(convert_to(entry->>'routeTaskId','UTF8'),decode('00','hex')) || decode('1f','hex') ||
      convert_to(entry->>'recordedAt','UTF8') || decode('1f','hex')), 'hex'),1,24) $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cp_model_charges (id text PRIMARY KEY, recorded_at timestamptz NOT NULL, charge jsonb);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cp_model_charges_recorded_at ON cp_model_charges (recorded_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cp_model_charge_pending (id text PRIMARY KEY, recorded_at timestamptz NOT NULL,
    log_key text NOT NULL, position bigint NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cp_model_charge_pending_at ON cp_model_charge_pending (recorded_at,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cp_model_spend_totals (level smallint NOT NULL, bucket bigint NOT NULL,
    usd numeric NOT NULL, known_usd numeric NOT NULL, measured bigint NOT NULL, unmeasured bigint NOT NULL,
    worst_case bigint NOT NULL, pending bigint NOT NULL DEFAULT 0, PRIMARY KEY (level,bucket));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_count_pending_model_charge() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE clock timestamptz; delta bigint;
    BEGIN
      IF TG_OP='INSERT' THEN clock := NEW.recorded_at; delta := 1;
      ELSE clock := OLD.recorded_at; delta := -1; END IF;
      INSERT INTO cp_model_spend_totals (level,bucket,usd,known_usd,measured,unmeasured,worst_case,pending)
        SELECT level,(floor(extract(epoch FROM clock)*1000)::bigint + 9007199254740992::bigint) >> (level*8),
          0,0,0,0,0,delta FROM generate_series(0,6) level
        ON CONFLICT (level,bucket) DO UPDATE SET pending=cp_model_spend_totals.pending+excluded.pending;
      RETURN NULL;
    END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_queue_model_charge() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE charge_id text := cp_cost_record_id(NEW.record);
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM cp_model_charges WHERE id=charge_id) THEN
        INSERT INTO cp_model_charge_pending (id,recorded_at,log_key,position)
          VALUES (charge_id,cp_cost_recorded_at(NEW.record),NEW.log_key,NEW.position) ON CONFLICT (id) DO NOTHING;
      END IF;
      RETURN NEW;
    END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_add_model_charge_totals() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.charge IS NOT NULL THEN
      INSERT INTO cp_model_spend_totals (level,bucket,usd,known_usd,measured,unmeasured,worst_case)
        SELECT level, (floor(extract(epoch FROM NEW.recorded_at)*1000)::bigint + 9007199254740992::bigint) >> (level*8),
          (NEW.charge->>'usd')::numeric, (NEW.charge->>'knownUsd')::numeric,
          CASE WHEN (NEW.charge->>'measured')::boolean THEN 1 ELSE 0 END,
          CASE WHEN (NEW.charge->>'measured')::boolean THEN 0 ELSE 1 END,
          CASE WHEN (NEW.charge->>'bounded')::boolean THEN 1 ELSE 0 END
        FROM generate_series(0,6) level
        ON CONFLICT (level,bucket) DO UPDATE SET usd=cp_model_spend_totals.usd+excluded.usd,
          known_usd=cp_model_spend_totals.known_usd+excluded.known_usd,
          measured=cp_model_spend_totals.measured+excluded.measured,
          unmeasured=cp_model_spend_totals.unmeasured+excluded.unmeasured,
          worst_case=cp_model_spend_totals.worst_case+excluded.worst_case;
    END IF;
    DELETE FROM cp_model_charge_pending WHERE id=NEW.id;
    RETURN NEW;
  END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_model_charge_pending_totals' AND tgrelid='cp_model_charge_pending'::regclass) THEN
      LOCK TABLE cp_model_charges,cp_model_charge_pending IN SHARE ROW EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_model_charge_pending_totals' AND tgrelid='cp_model_charge_pending'::regclass) THEN
        ALTER TABLE cp_model_spend_totals ADD COLUMN IF NOT EXISTS pending bigint NOT NULL DEFAULT 0;
        INSERT INTO cp_model_spend_totals (level,bucket,usd,known_usd,measured,unmeasured,worst_case,pending)
          SELECT level,(floor(extract(epoch FROM recorded_at)*1000)::bigint + 9007199254740992::bigint) >> (level*8) bucket,
            0,0,0,0,0,count(*) FROM cp_model_charge_pending CROSS JOIN generate_series(0,6) level GROUP BY level,bucket
          ON CONFLICT (level,bucket) DO UPDATE SET pending=cp_model_spend_totals.pending+excluded.pending;
        CREATE TRIGGER cp_model_charge_pending_totals AFTER INSERT OR DELETE ON cp_model_charge_pending
          FOR EACH ROW EXECUTE FUNCTION cp_count_pending_model_charge();
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_model_charges_totals' AND tgrelid='cp_model_charges'::regclass) THEN
      BEGIN
        CREATE TRIGGER cp_model_charges_totals AFTER INSERT ON cp_model_charges FOR EACH ROW EXECUTE FUNCTION cp_add_model_charge_totals();
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_log_costs_price_pending' AND tgrelid='cp_log_costs'::regclass) THEN
      BEGIN
        CREATE TRIGGER cp_log_costs_price_pending AFTER INSERT ON cp_log_costs FOR EACH ROW EXECUTE FUNCTION cp_queue_model_charge();
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    END IF;
  END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cp_log_costs_charge_at ON cp_log_costs (cp_cost_recorded_at(record), log_key, position);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cp_log_research_intents_action_time ON cp_log_research_intents (log_key,(record #>> '{action}'),(record #>> '{requestedAt}') DESC,position DESC) WHERE record @> '{"kind":"INTENT"}'::jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cp_log_research_intents_intent ON cp_log_research_intents (log_key,(record #>> '{intentId}'),position DESC) WHERE record @> '{"kind":"INTENT"}'::jsonb;
--> statement-breakpoint
DO $$ BEGIN
  IF coalesce((SELECT version FROM cp_schema_version WHERE singleton),0) < 33 THEN
  IF to_regclass('cp_spend_window') IS NOT NULL THEN
    INSERT INTO cp_model_charges (id,recorded_at,charge)
      SELECT charge->>'id', (charge->>'at')::timestamptz, charge
      FROM cp_spend_window, LATERAL jsonb_array_elements(value->'charges') charge
      ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO cp_model_charge_pending (id,recorded_at,log_key,position)
    SELECT cp_cost_record_id(record),cp_cost_recorded_at(record),log_key,position FROM cp_log_costs l
    WHERE cp_cost_recorded_at(record) >= now() - interval '30 hours'
      AND NOT EXISTS (SELECT 1 FROM cp_model_charges c WHERE c.id=cp_cost_record_id(l.record))
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cp_spend_holds (
     hold_id          text PRIMARY KEY,
     job_id           text NOT NULL,
     obligation_id    text NOT NULL,
     keys             text[] NOT NULL,
     lifetime_keys    text[] NOT NULL DEFAULT '{}',
     usd              numeric NOT NULL,
     held_at          timestamptz NOT NULL,
     what             text NOT NULL,
     settled_usd      numeric,
     cost_recorded_at timestamptz,
     changed_at       timestamptz NOT NULL DEFAULT now()
   );
--> statement-breakpoint
DO $do$ BEGIN
  IF to_regclass('cp_spend_holds_keys') IS NULL THEN
    CREATE INDEX IF NOT EXISTS cp_spend_holds_keys ON cp_spend_holds USING gin (keys);
  END IF;
  IF to_regclass('cp_spend_holds_job') IS NULL THEN
    CREATE INDEX IF NOT EXISTS cp_spend_holds_job ON cp_spend_holds (job_id);
  END IF;
  IF to_regclass('cp_spend_holds_unsettled') IS NULL THEN
    CREATE INDEX IF NOT EXISTS cp_spend_holds_unsettled ON cp_spend_holds (held_at) WHERE cost_recorded_at IS NULL;
  END IF;
  IF to_regclass('cp_spend_holds_settled') IS NULL THEN
    CREATE INDEX IF NOT EXISTS cp_spend_holds_settled ON cp_spend_holds (cost_recorded_at) WHERE cost_recorded_at IS NOT NULL;
  END IF;
  IF to_regclass('cp_spend_holds_held_at') IS NULL THEN
    CREATE INDEX IF NOT EXISTS cp_spend_holds_held_at ON cp_spend_holds (held_at);
  END IF;
  IF to_regclass('cp_spend_holds_rolling_expiry') IS NULL THEN
    CREATE INDEX IF NOT EXISTS cp_spend_holds_rolling_expiry ON cp_spend_holds (held_at) WHERE cardinality(lifetime_keys) = 0;
  END IF;
END $do$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_adjust_spend_line(h cp_spend_holds, direction integer) RETURNS void LANGUAGE plpgsql AS $$
  DECLARE k text; held numeric := extract(epoch FROM h.held_at)*1000000 + 9223372036854775808::numeric;
    cost_at numeric := extract(epoch FROM h.cost_recorded_at)*1000000 + 9223372036854775808::numeric;
  BEGIN
    FOR k IN SELECT DISTINCT unnest(h.keys) ORDER BY 1 LOOP
      INSERT INTO cp_spend_line_totals (line_key,scope,held_level,cost_level,held_bucket,cost_bucket,usd)
        SELECT k,CASE WHEN cardinality(h.lifetime_keys)>0 THEN 1 ELSE 0 END,x.level,y.level,div(held,power(256::numeric,x.level)),
          CASE WHEN y.level=-1 THEN 0 ELSE div(cost_at,power(256::numeric,y.level)) END,
          direction * CASE WHEN h.cost_recorded_at IS NULL THEN h.usd ELSE coalesce(h.settled_usd,0) END
        FROM generate_series(0,7) x(level) CROSS JOIN LATERAL (
          SELECT -1 level WHERE h.cost_recorded_at IS NULL UNION ALL
          SELECT generate_series(0,7) WHERE h.cost_recorded_at IS NOT NULL) y
        ON CONFLICT (line_key,scope,held_level,cost_level,held_bucket,cost_bucket)
          DO UPDATE SET usd=cp_spend_line_totals.usd+excluded.usd;
    END LOOP;
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_update_spend_lines() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM cp_adjust_spend_line(OLD,-1); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM cp_adjust_spend_line(NEW,1); END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
DO $$ BEGIN
    LOCK TABLE cp_spend_holds IN SHARE ROW EXCLUSIVE MODE;
    IF to_regclass('cp_spend_line_totals') IS NULL THEN
      CREATE TABLE cp_spend_line_totals (line_key text NOT NULL,scope smallint NOT NULL,
        held_level smallint NOT NULL,cost_level smallint NOT NULL,held_bucket numeric(20,0) NOT NULL,cost_bucket numeric(20,0) NOT NULL,
        usd numeric NOT NULL,PRIMARY KEY (line_key,scope,held_level,cost_level,held_bucket,cost_bucket));
      INSERT INTO cp_spend_line_totals (line_key,scope,held_level,cost_level,held_bucket,cost_bucket,usd)
        SELECT k.line_key,CASE WHEN cardinality(h.lifetime_keys)>0 THEN 1 ELSE 0 END,x.level,y.level,
          div(extract(epoch FROM h.held_at)*1000000+9223372036854775808::numeric,power(256::numeric,x.level)),
          CASE WHEN y.level=-1 THEN 0 ELSE
            div(extract(epoch FROM h.cost_recorded_at)*1000000+9223372036854775808::numeric,power(256::numeric,y.level)) END,
          sum(CASE WHEN h.cost_recorded_at IS NULL THEN h.usd ELSE coalesce(h.settled_usd,0) END)
        FROM cp_spend_holds h CROSS JOIN LATERAL (SELECT DISTINCT unnest(h.keys) line_key) k
        CROSS JOIN generate_series(0,7) x(level) CROSS JOIN LATERAL (
          SELECT -1 level WHERE h.cost_recorded_at IS NULL UNION ALL
          SELECT generate_series(0,7) WHERE h.cost_recorded_at IS NOT NULL) y
        GROUP BY 1,2,3,4,5,6;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_spend_holds_totals' AND tgrelid='cp_spend_holds'::regclass) THEN
      CREATE TRIGGER cp_spend_holds_totals AFTER INSERT OR UPDATE OR DELETE ON cp_spend_holds
        FOR EACH ROW EXECUTE FUNCTION cp_update_spend_lines();
    END IF;
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_spend_suffix_ranges(at timestamptz)
    RETURNS TABLE(level smallint,lower numeric,upper numeric,sign integer) LANGUAGE sql IMMUTABLE ROWS 9 AS $$
    WITH point AS (SELECT extract(epoch FROM at)*1000000+9223372036854775808::numeric value)
    SELECT 7::smallint,0::numeric,256::numeric,1 UNION ALL
    SELECT n::smallint,div(value,power(256::numeric,n))-mod(div(value,power(256::numeric,n)),256),div(value,power(256::numeric,n)),-1
      FROM point CROSS JOIN generate_series(0,7) n WHERE mod(div(value,power(256::numeric,n)),256) <> 0 $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cp_spend_line_left(l jsonb,win timestamptz,stale timestamptz,kept timestamptz)
    RETURNS numeric LANGUAGE sql STABLE SET jit=off AS $$
    WITH scopes AS (SELECT scope,scope=1 AND coalesce((l->>'lifetime')::boolean,false) lifetime FROM generate_series(0,1) scope),
    open_amount AS (
      SELECT coalesce(sum(t.usd*h.sign),0) usd FROM scopes s
      CROSS JOIN LATERAL cp_spend_suffix_ranges(CASE WHEN s.lifetime THEN stale ELSE greatest(win,stale) END) h
      CROSS JOIN LATERAL (SELECT usd FROM cp_spend_line_totals WHERE line_key=l->>'key' AND scope=s.scope
        AND held_level=h.level AND cost_level=-1 AND held_bucket>=h.lower AND held_bucket<h.upper AND cost_bucket=0 OFFSET 0) t
    ), settled_amount AS (
      SELECT coalesce(sum(t.usd*h.sign*c.sign),0) usd FROM scopes s
      CROSS JOIN LATERAL cp_spend_suffix_ranges(CASE WHEN s.lifetime THEN NULL ELSE win END) h
      CROSS JOIN LATERAL cp_spend_suffix_ranges(greatest(kept,(l->>'historyReadAt')::timestamptz+interval '1 microsecond')) c
      CROSS JOIN LATERAL (SELECT usd FROM cp_spend_line_totals WHERE line_key=l->>'key' AND scope=s.scope
        AND held_level=h.level AND cost_level=c.level AND held_bucket>=h.lower AND held_bucket<h.upper
        AND cost_bucket>=c.lower AND cost_bucket<c.upper OFFSET 0) t
      WHERE l->>'historyReadAt' IS NOT NULL
    ) SELECT round(((l->>'budgetUsd')::numeric-(l->>'historicalUsd')::numeric-o.usd-s.usd)*1000000000)/1000000000
      FROM open_amount o CROSS JOIN settled_amount s $$;
--> statement-breakpoint
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cp_admit_spend_hold'
      AND pronamespace = current_schema()::regnamespace AND prosrc LIKE '%cp_admit_spend_hold body MS-01%') THEN
    BEGIN
      CREATE OR REPLACE FUNCTION cp_admit_spend_hold(hold jsonb, lines jsonb, now_at timestamptz,
          window_ms bigint, stale_ms bigint, retention_ms bigint, prune_limit integer)
        RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $fn$
      -- cp_admit_spend_hold body MS-01
      DECLARE
        hid text := hold->>'holdId';
        amount numeric := (hold->>'usd')::numeric;
        win timestamptz := now_at - window_ms * interval '1 millisecond';
        stale timestamptz := now_at - stale_ms * interval '1 millisecond';
        kept timestamptz := now_at - retention_ms * interval '1 millisecond';
        sends jsonb := coalesce(lines->'sends', '[]'::jsonb);
        areas jsonb := coalesce(lines->'areas', '[]'::jsonb);
        line_keys text[];
        k text;
        l jsonb;
        line_left numeric;
        first_left numeric;
        fits boolean := false;
        pos integer := 0;
        found_hold jsonb;
      BEGIN
        SELECT coalesce(array_agg(DISTINCT e->>'key' ORDER BY e->>'key'), '{}') INTO line_keys
          FROM jsonb_array_elements(sends || areas) AS e;
        -- One lock per line, in one order, held until this statement's transaction ends.
        FOREACH k IN ARRAY line_keys LOOP
          PERFORM pg_advisory_xact_lock(hashtextextended('cp_spend_holds:' || k, 0));
        END LOOP;
        DELETE FROM cp_spend_holds d WHERE d.hold_id = hid AND ((d.cost_recorded_at IS NULL AND d.held_at < stale) OR (d.cost_recorded_at IS NOT NULL AND d.cost_recorded_at < kept) OR (cardinality(d.lifetime_keys) = 0 AND d.held_at < win));
        DELETE FROM cp_spend_holds x WHERE x.hold_id IN (SELECT hold_id FROM (
    (SELECT hold_id FROM cp_spend_holds WHERE cost_recorded_at IS NULL AND held_at < stale LIMIT prune_limit)
    UNION ALL (SELECT hold_id FROM cp_spend_holds WHERE cost_recorded_at IS NOT NULL AND cost_recorded_at < kept LIMIT prune_limit)
    UNION ALL (SELECT hold_id FROM cp_spend_holds WHERE cardinality(lifetime_keys) = 0 AND held_at < win LIMIT prune_limit)
  ) expired LIMIT prune_limit);
        -- Idempotent by hold id.
        SELECT jsonb_build_object('holdId', h.hold_id, 'jobId', h.job_id, 'obligationId', h.obligation_id, 'keys', to_jsonb(h.keys), 'lifetimeKeys', to_jsonb(h.lifetime_keys), 'usd', h.usd, 'heldAt', to_char(h.held_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'what', h.what, 'settled', CASE WHEN h.cost_recorded_at IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('usd', h.settled_usd, 'costRecordedAt', to_char(h.cost_recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END) INTO found_hold FROM cp_spend_holds h WHERE h.hold_id = hid;
        IF found_hold IS NOT NULL THEN RETURN jsonb_build_object('admit', true, 'hold', found_hold); END IF;
        IF cardinality(line_keys) = 0 THEN RETURN jsonb_build_object('admit', true, 'hold', 'null'::jsonb); END IF;
        IF amount IS NULL OR amount < 0 THEN RETURN jsonb_build_object('admit', false, 'refusal', 'AMOUNT'); END IF;
        -- Sends: one with room suffices.
        IF jsonb_array_length(sends) > 0 THEN
          FOR l IN SELECT e FROM jsonb_array_elements(sends) WITH ORDINALITY AS t(e, n) ORDER BY n LOOP
            line_left := cp_spend_line_left(l,win,stale,kept);
            IF first_left IS NULL THEN first_left := coalesce(line_left, 0); END IF;
            IF line_left >= amount THEN fits := true; EXIT; END IF;
          END LOOP;
          IF NOT fits THEN RETURN jsonb_build_object('admit', false, 'refusal', 'SEND', 'left', first_left); END IF;
        END IF;
        -- Every area, then every lifetime Send: each must have room.
        FOR l IN SELECT e FROM (
            SELECT e, 0 AS part, n FROM jsonb_array_elements(areas) WITH ORDINALITY AS a(e, n)
            UNION ALL
            SELECT e, 1 AS part, n FROM jsonb_array_elements(sends) WITH ORDINALITY AS s(e, n)
              WHERE coalesce((e->>'lifetime')::boolean, false)) every_line ORDER BY part, n LOOP
          line_left := cp_spend_line_left(l,win,stale,kept);
          IF line_left IS NULL OR line_left < amount THEN
            RETURN jsonb_build_object('admit', false, 'refusal', 'AREA', 'left', coalesce(line_left, 0), 'position', pos);
          END IF;
          pos := pos + 1;
        END LOOP;
        INSERT INTO cp_spend_holds (hold_id, job_id, obligation_id, keys, lifetime_keys, usd, held_at, what)
          VALUES (hid, hold->>'jobId', hold->>'obligationId',
            ARRAY(SELECT e->>'key' FROM jsonb_array_elements(sends || areas) WITH ORDINALITY AS t(e, n) ORDER BY n),
            ARRAY(SELECT e->>'key' FROM jsonb_array_elements(sends || areas) WITH ORDINALITY AS t(e, n)
              WHERE coalesce((e->>'lifetime')::boolean, false) ORDER BY n),
            amount, now_at, hold->>'what')
          ON CONFLICT (hold_id) DO NOTHING;
        SELECT jsonb_build_object('holdId', h.hold_id, 'jobId', h.job_id, 'obligationId', h.obligation_id, 'keys', to_jsonb(h.keys), 'lifetimeKeys', to_jsonb(h.lifetime_keys), 'usd', h.usd, 'heldAt', to_char(h.held_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'what', h.what, 'settled', CASE WHEN h.cost_recorded_at IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('usd', h.settled_usd, 'costRecordedAt', to_char(h.cost_recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END) INTO found_hold FROM cp_spend_holds h WHERE h.hold_id = hid;
        RETURN jsonb_build_object('admit', true, 'hold', found_hold);
      END $fn$;
    -- Two first bootstraps can both pass the check; the other one installed the same body.
    EXCEPTION WHEN unique_violation OR internal_error THEN NULL;
    END;
  END IF;
END $do$;
