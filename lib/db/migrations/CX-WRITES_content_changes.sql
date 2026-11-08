-- Identical source bytes can be reused by every publisher without reading their body.
CREATE INDEX source_copy_content ON source_copy(final_url,sha256,http_status);
--> statement-breakpoint
-- Readers resolve current checks through this shared index. Keep a small pending
-- buffer so each displayed fact does not scan a backlog of unchanged memberships.
ALTER INDEX fact_confirmation_members SET (gin_pending_list_limit=64);
--> statement-breakpoint
SELECT gin_clean_pending_list('fact_confirmation_members');
