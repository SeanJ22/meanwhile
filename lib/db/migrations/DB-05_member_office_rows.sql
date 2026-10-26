CREATE FUNCTION refresh_member_office_rows(p_key text,p_scope text,p_version text,p_at timestamptz,p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE member record; source record; place record; document jsonb; review jsonb; part jsonb; aliases text[]; state_code text;
  row_number bigint:=0; source_number bigint:=0; native text; review_aliases text[]; state_review jsonb;
BEGIN
  IF p_scope <> 'US:state-legislator-member-offices' AND p_scope !~ '^US-[A-Z]{2}:state-legislator-member-offices$' THEN RETURN; END IF;
  DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection IN ('memberOffices','memberOfficeSources');
  FOR member IN SELECT * FROM reader_payload_members(reader_payload_node(p_payload)->'records') ORDER BY ordinal_index LOOP
    document:=reader_payload_node(member.item); native:=document->>'officeholderId';
    state_code:=upper(coalesce(substring(native FROM '^(?:plural|statewide|legiscan|official-legislature|wikidata|congress-api|govinfo):([a-z]{2}):'),
      substring(native FROM '^([a-z]{2})-(?:legislature|general-court):'),
      reader_payload_node(document->'office')->>'state',substring(p_scope FROM '^US-([A-Z]{2}):'),
      substring(document->>'sourceUrl' FROM '/data/([a-z]{2})/'),substring(document->>'sourceUrl' FROM '/current/([a-z]{2})\.csv')));
    SELECT coalesce(array_agg(DISTINCT value#>>'{}'),'{}'::text[]) INTO aliases
      FROM jsonb_path_query(reader_payload_value(document),'$.** ? (@.type() == "string")') AS found(value)
      WHERE value#>>'{}' ~ '^https://[^[:space:]]+$';
    INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,body_id,state,aliases,value,content_hash)
      VALUES(p_key,'CURATED_READER_RECORD',p_scope,p_version,p_at,'memberOffices',member.ordinal_index,document->>'id',native,state_code,aliases,document,
        encode(sha256(convert_to(document::text,'UTF8')),'hex'));
  END LOOP;
  FOR source IN SELECT sources.item,sources.ordinal_index FROM civic_data_candidates c
    CROSS JOIN LATERAL reader_payload_members(reader_payload_node(reader_payload_node(c.candidate->'retrieval')->'manualSourceReceipt')->'sources') sources
    WHERE c.id=p_version ORDER BY sources.ordinal_index LOOP
    review:=reader_payload_node(source.item);
    IF review->>'reviewOutcome'='BLOCKED' THEN CONTINUE; END IF;
    SELECT coalesce(array_agg(DISTINCT url),'{}'::text[]) INTO review_aliases FROM (
      SELECT review->>'requestedUrl' AS url UNION ALL SELECT review->>'finalUrl'
      UNION ALL SELECT 'https://raw.githubusercontent.com/openstates/people/' || substring(review->>'finalUrl' FROM '/zip/([a-f0-9]{40})$') || '/' || (reader_payload_node(m.item)->>'path')
        FROM reader_payload_members(review->'extractedMembers') m
        WHERE review->>'finalUrl' ~ '^https://codeload\.github\.com/openstates/people/zip/[a-f0-9]{40}$'
    ) urls WHERE url IS NOT NULL;
    FOR place IN SELECT DISTINCT r.state FROM civic_data_rows r WHERE r.promotion_key=p_key AND r.collection='memberOffices'
      AND r.aliases && review_aliases LOOP
      state_review:=review;
      IF review ? 'extractedMembers' THEN
        SELECT coalesce(jsonb_agg(reader_payload_value(m.item) ORDER BY m.ordinal_index),'[]'::jsonb) INTO part
          FROM reader_payload_members(review->'extractedMembers') m
          WHERE reader_payload_node(m.item)->>'path' ~ ('^data/' || lower(place.state) || '/');
        state_review:=review || jsonb_build_object('extractedMembers',part);
      END IF;
      source_number:=source_number+1;
      INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,state,aliases,value,content_hash)
        VALUES(p_key,'CURATED_READER_RECORD',p_scope,p_version,p_at,'memberOfficeSources',source_number,source.ordinal_index::text,place.state,review_aliases,state_review,
          encode(sha256(convert_to(state_review::text,'UTF8')),'hex'));
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION member_office_rows_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_class='CURATED_READER_RECORD' THEN
    PERFORM refresh_member_office_rows(NEW.key,NEW.scope,NEW.current_version_id,NEW.promoted_at,NEW.payload);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER member_office_rows_changed AFTER INSERT OR UPDATE OF key,record_class,scope,current_version_id,promoted_at,payload
  ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION member_office_rows_changed();
--> statement-breakpoint
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT * FROM civic_data_promotions WHERE record_class='CURATED_READER_RECORD'
    AND (scope='US:state-legislator-member-offices' OR scope ~ '^US-[A-Z]{2}:state-legislator-member-offices$') LOOP
    PERFORM refresh_member_office_rows(p.key,p.scope,p.current_version_id,p.promoted_at,p.payload);
  END LOOP;
END $$;
