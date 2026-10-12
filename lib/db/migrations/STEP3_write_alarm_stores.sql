-- STEP3: permit the reader stores that already report through write_alarm.
-- Widen only the existing store-name check; retain every row and column.
-- River assigns the final migration number. Apply this compatible expansion
-- before serving code that records Ask, Speak, and demand write failures.
ALTER TABLE "write_alarm" DROP CONSTRAINT "write_alarm_store_known";
--> statement-breakpoint
ALTER TABLE "write_alarm" ADD CONSTRAINT "write_alarm_store_known" CHECK ("store" IN ('search_log', 'reactions', 'speak_your_mind', 'demand_signals', 'ask_interactions'));
