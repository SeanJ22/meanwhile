ALTER TABLE "meetings" ALTER COLUMN "ocd_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "division_vintage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "location_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "location_lat" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "location_lng" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_label" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "online_join_url" text;