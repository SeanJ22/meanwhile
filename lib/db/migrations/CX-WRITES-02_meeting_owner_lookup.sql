CREATE INDEX civic_data_rows_meeting_owner ON civic_data_rows ((split_part(body_id,'#',1)))
  WHERE record_class='MEETING' AND collection='meetings';
--> statement-breakpoint
CREATE INDEX civic_data_rows_meeting_division ON civic_data_rows ((value->>'ocdId'))
  WHERE record_class='MEETING' AND collection='meetings';
