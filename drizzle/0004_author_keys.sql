ALTER TABLE "events" ADD COLUMN "author_key" text;--> statement-breakpoint
ALTER TABLE "planned_events" ADD COLUMN "author_key" text;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "author_key" text;