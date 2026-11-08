CREATE INDEX civic_data_rows_meeting_owner ON civic_data_rows ((split_part(body_id,'#',1)))
  WHERE record_class='MEETING' AND collection='meetings';
--> statement-breakpoint
CREATE INDEX civic_data_rows_meeting_division ON civic_data_rows ((value->>'ocdId'))
  WHERE record_class='MEETING' AND collection='meetings';
--> statement-breakpoint
-- CX-WRITES-02 source clock class.
CREATE OR REPLACE FUNCTION civic_source_clock_class(candidate jsonb)
  RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN coalesce(meta."bootstrapImport"->>'kind','') IN ('TRUSTED_LKG_IMPORT','TRUSTED_LKG_REATTESTATION')
    OR coalesce(meta."stateRetirement"->>'kind','')='STATE_AUTHORITY_RETIREMENT' THEN 2
    WHEN meta.retrieval#>>'{sourceCheck,checkedAt}' IS NOT NULL THEN 1 ELSE 0 END
  FROM jsonb_to_record(candidate) AS meta("bootstrapImport" jsonb,"stateRetirement" jsonb,retrieval jsonb)
$$;
