ALTER TABLE owner_flag ADD CONSTRAINT owner_flag_target CHECK (fact_id IS NOT NULL OR (reader_family IS NOT NULL AND reader_id IS NOT NULL));
