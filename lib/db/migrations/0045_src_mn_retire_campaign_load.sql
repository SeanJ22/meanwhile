ALTER TABLE civic_data_promotions DISABLE TRIGGER civic_data_promotions_no_delete_or_rewrite;
--> statement-breakpoint
ALTER TABLE civic_data_candidate_events DISABLE TRIGGER civic_data_candidate_events_append_only;
--> statement-breakpoint
ALTER TABLE civic_data_candidates DISABLE TRIGGER civic_data_candidates_immutable_evidence;
--> statement-breakpoint
DO $$
DECLARE
  jurisdiction text;
  committee record;
  removed integer;
  fact_count bigint;
  publication_count bigint;
  candidate_count bigint;
  source text;
BEGIN
  FOR jurisdiction IN SELECT unnest(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','AS','GU','MP','PR','VI']) LOOP
    fact_count := 0;
    source := 'US-' || jurisdiction || ':campaign-finance-source';
    FOR committee IN SELECT id FROM entity WHERE state=jurisdiction AND kind='committee' ORDER BY id LOOP
      LOOP
        WITH doomed AS MATERIALIZED (
          SELECT id FROM fact WHERE entity_id=committee.id
            AND produced_by LIKE 'campaign-finance:' || jurisdiction || ':%'
            AND field LIKE 'campaign-money:%' ORDER BY id LIMIT 500
        ), flags AS (
          DELETE FROM owner_flag USING doomed WHERE owner_flag.fact_id=doomed.id
        ), removed_facts AS (
          DELETE FROM fact USING doomed WHERE fact.id=doomed.id RETURNING fact.id
        ) SELECT count(*) INTO removed FROM removed_facts;
        fact_count := fact_count + removed;
        EXIT WHEN removed=0;
      END LOOP;
      IF committee.id LIKE 'campaign-committee:' || jurisdiction || ':%'
        AND NOT EXISTS(SELECT 1 FROM fact WHERE entity_id=committee.id)
        AND NOT EXISTS(SELECT 1 FROM entity WHERE parent_id=committee.id)
        AND NOT EXISTS(SELECT 1 FROM entity_host WHERE entity_id=committee.id)
        AND NOT EXISTS(SELECT 1 FROM blank WHERE entity_id=committee.id) THEN
        DELETE FROM entity_external_id WHERE entity_id=committee.id AND scheme='campaign-money-record';
        IF NOT EXISTS(SELECT 1 FROM entity_external_id WHERE entity_id=committee.id) THEN
          DELETE FROM entity_place WHERE entity_id=committee.id;
          DELETE FROM entity WHERE id=committee.id;
        END IF;
      END IF;
    END LOOP;
    DELETE FROM civic_data_promotions WHERE source_id=source AND record_class='CAMPAIGN_FINANCE';
    GET DIAGNOSTICS publication_count = ROW_COUNT;
    DELETE FROM civic_data_candidate_events e USING civic_data_candidates c
      WHERE e.candidate_id=c.id AND c.source_id=source AND c.record_class='CAMPAIGN_FINANCE';
    DELETE FROM civic_data_candidates WHERE source_id=source AND record_class='CAMPAIGN_FINANCE';
    GET DIAGNOSTICS candidate_count = ROW_COUNT;
    IF fact_count>0 THEN
      INSERT INTO fact_watermark(scope,version) VALUES(jurisdiction,1)
        ON CONFLICT(scope) DO UPDATE SET version=fact_watermark.version+1;
    END IF;
    INSERT INTO pass_cursor(name,position) VALUES('campaign-money:retired:' || jurisdiction,
      json_build_object('factsRemoved',fact_count,'publicationsRemoved',publication_count,'candidatesRemoved',candidate_count,'checkedAt',clock_timestamp())::text)
      ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position;
  END LOOP;
END $$;
--> statement-breakpoint
DELETE FROM pass_cursor WHERE name ~ '^campaign-finance:[A-Z]{2}:';
--> statement-breakpoint
ALTER TABLE civic_data_candidates ENABLE TRIGGER civic_data_candidates_immutable_evidence;
--> statement-breakpoint
ALTER TABLE civic_data_candidate_events ENABLE TRIGGER civic_data_candidate_events_append_only;
--> statement-breakpoint
ALTER TABLE civic_data_promotions ENABLE TRIGGER civic_data_promotions_no_delete_or_rewrite;
