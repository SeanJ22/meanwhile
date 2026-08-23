CREATE TABLE "questionnaire_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidacy_id" text NOT NULL,
	"contest_id" text NOT NULL,
	"email" text NOT NULL,
	"instrument_version" text NOT NULL,
	"office_class" text NOT NULL,
	"planned_invited_on" text NOT NULL,
	"planned_reminders_on" jsonb NOT NULL,
	"deadline" text NOT NULL,
	"invited_on" text,
	"reminded_on" jsonb NOT NULL,
	"contact_source_url" text NOT NULL,
	"contact_source_org" text NOT NULL,
	"contact_collected_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidacy_id" text NOT NULL,
	"version" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"instrument_version" text NOT NULL,
	"office_class" text NOT NULL,
	"answers" jsonb NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questionnaire_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_digest" text NOT NULL,
	"candidacy_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_invitations_candidacy_idx" ON "questionnaire_invitations" USING btree ("candidacy_id");--> statement-breakpoint
CREATE INDEX "questionnaire_invitations_contest_idx" ON "questionnaire_invitations" USING btree ("contest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_candidacy_version_idx" ON "questionnaire_responses" USING btree ("candidacy_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_tokens_digest_idx" ON "questionnaire_tokens" USING btree ("token_digest");