CREATE TABLE "reader_event_refusals" (
  "day" date NOT NULL,
  "reason" text NOT NULL,
  "refusals" bigint NOT NULL,
  PRIMARY KEY ("day", "reason")
);
