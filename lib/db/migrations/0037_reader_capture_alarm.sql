-- Keep the existing capture-failure alarm usable for every supported writer.
ALTER TABLE "write_alarm" DROP CONSTRAINT "write_alarm_store_known";
--> statement-breakpoint
ALTER TABLE "write_alarm" ADD CONSTRAINT "write_alarm_store_known"
CHECK ("store" IN ('search_log', 'reactions', 'speak_your_mind', 'demand_signals', 'reader_events'));
