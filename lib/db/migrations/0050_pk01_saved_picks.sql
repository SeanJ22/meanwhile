CREATE TABLE "saved_ballot_picks" (
  "secret_hash" text PRIMARY KEY NOT NULL,
  "revision" integer NOT NULL,
  "file" jsonb NOT NULL
);
