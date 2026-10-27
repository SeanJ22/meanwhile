CREATE TABLE reader_body_roster (
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL
);
