-- STEP-7: retain Ask words exactly and count location demand by district and reader.
-- River numbers this migration and coordinates the question-column rename with release.
ALTER TABLE "ask_interactions" RENAME COLUMN "question_scrubbed" TO "question";
--> statement-breakpoint
ALTER TABLE "search_log" ADD COLUMN "continuity_hash" text;
--> statement-breakpoint
-- The released bridge retained these hashes while the contract waited for the deployed commit.
UPDATE "search_log"
SET "continuity_hash" = "detail"->>'__step7_continuity_hash',
    "detail" = CASE WHEN "detail" - '__step7_continuity_hash' = '{}'::jsonb
      THEN NULL ELSE "detail" - '__step7_continuity_hash' END
WHERE "detail" ? '__step7_continuity_hash';
--> statement-breakpoint
ALTER TABLE "search_log" ADD CONSTRAINT "search_log_event_type_known" CHECK ("event_type" IN ('SEARCH', 'BODY_OPENED', 'MEETING_OPENED', 'DISTRICT_SELECTED', 'FILTER_APPLIED', 'OFFICIAL_OPENED', 'QUESTION_ASKED', 'ADDRESS_ENTERED', 'BALLOT_VIEWED'));
