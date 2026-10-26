DROP TRIGGER rb_a7_bootstrap_queue_before ON rebuild_queue;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_queue_inserted ON rebuild_queue;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_queue_updated ON rebuild_queue;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_pointer ON civic_data_promotions;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_confirmation ON civic_data_candidate_events;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_fact ON fact;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_entity_before ON entity;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_entity_after ON entity;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_place_before ON entity_place;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_place_after ON entity_place;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_host_before ON entity_host;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_host_after ON entity_host;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_alias_before ON entity_external_id;
--> statement-breakpoint
DROP TRIGGER rb_a7_bootstrap_alias_after ON entity_external_id;
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_queue_insert();
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_queue_dependents();
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_pointer_changed();
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_confirmed();
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_publication(text,text);
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_fact_changed();
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
DROP FUNCTION rb_a7_bootstrap_subject(text);
--> statement-breakpoint
DROP INDEX rb_a7_bootstrap_zip_dependency;
--> statement-breakpoint
DROP INDEX rb_a7_bootstrap_host_lookup;
