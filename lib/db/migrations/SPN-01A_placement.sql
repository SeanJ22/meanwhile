CREATE INDEX IF NOT EXISTS blank_placement_due ON blank (next_try_at) WHERE reason = 'PLACEMENT_QUESTION';
