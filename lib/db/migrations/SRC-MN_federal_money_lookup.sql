DROP INDEX IF EXISTS "civic_data_promotions_federal_lookup_idx";
CREATE INDEX "civic_data_promotions_federal_lookup_idx" ON "civic_data_promotions"
USING gin ((payload->'lookupKeys') jsonb_path_ops)
WHERE payload ? 'lookupKeys';
