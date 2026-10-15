-- phase: contract
ALTER TABLE civic_data_promotions DISABLE TRIGGER civic_data_promotions_no_delete_or_rewrite;
--> statement-breakpoint
DELETE FROM civic_data_promotions WHERE record_class = 'MEETING' AND scope LIKE 'source:derived:family:US-%';
--> statement-breakpoint
ALTER TABLE civic_data_promotions ENABLE TRIGGER civic_data_promotions_no_delete_or_rewrite;
