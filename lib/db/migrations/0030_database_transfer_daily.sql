CREATE TABLE "database_transfer_daily" (
  "day" date NOT NULL,
  "database_name" text NOT NULL,
  "client" text NOT NULL,
  "requests" bigint NOT NULL DEFAULT 0,
  "request_bytes" bigint NOT NULL DEFAULT 0,
  "response_bytes" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("day", "database_name", "client")
);
