CREATE TABLE civic_data_source_checks (
  record_class text NOT NULL,
  scope text NOT NULL,
  source_key text NOT NULL,
  source_id text NOT NULL,
  pointer_version_id text NOT NULL,
  raw_hash text NOT NULL,
  source_raw_hash text,
  parser_version text NOT NULL,
  checked_at timestamptz NOT NULL,
  source_urls text[] NOT NULL,
  jurisdiction_ids text[] NOT NULL,
  PRIMARY KEY (record_class, scope, source_key)
);
