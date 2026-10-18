CREATE INDEX "civic_data_candidate_events_confirmed_at_idx" ON "civic_data_candidate_events" ("at") WHERE left("detail", 26) = 'UNCHANGED_CONFIRMATION_V1 ';
