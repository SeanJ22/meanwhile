CREATE INDEX CONCURRENTLY IF NOT EXISTS civic_data_candidates_source_clock
  ON civic_data_candidates(source_id,record_class,scope,parser_version,civic_source_clock_class(candidate));
