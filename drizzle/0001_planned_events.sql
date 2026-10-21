CREATE TABLE "planned_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_item_id" bigint,
	"source" "raw_source" NOT NULL,
	"source_feed" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"time_known" boolean DEFAULT false NOT NULL,
	"location_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"h3_cells" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_class" "source_class" NOT NULL,
	"extractor" "extractor" NOT NULL,
	"confidence" real NOT NULL,
	"credibility" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cells_snapshot" ADD COLUMN "planned" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_events_starts_at" ON "planned_events" USING btree ("starts_at");