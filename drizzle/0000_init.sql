CREATE TYPE "public"."event_type" AS ENUM('clashes', 'march', 'blockade', 'police_presence', 'peaceful_gathering', 'aftermath');--> statement-breakpoint
CREATE TYPE "public"."extractor" AS ENUM('gemini', 'ollama', 'rules');--> statement-breakpoint
CREATE TYPE "public"."raw_source" AS ENUM('news', 'tper', 'official', 'bluesky', 'mastodon', 'reddit', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."source_class" AS ENUM('social', 'news', 'official', 'transit');--> statement-breakpoint
CREATE TABLE "cell_overrides" (
	"h3" text PRIMARY KEY NOT NULL,
	"level" smallint NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cell_overrides_level_range" CHECK ("cell_overrides"."level" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "cells_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"cells" jsonb NOT NULL,
	"reduced_accuracy" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_item_id" bigint,
	"source" "raw_source" NOT NULL,
	"source_feed" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"severity" smallint NOT NULL,
	"confidence" real NOT NULL,
	"is_firsthand" boolean DEFAULT false NOT NULL,
	"credibility" real NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"h3_cells" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_class" "source_class" NOT NULL,
	"extractor" "extractor" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_severity_range" CHECK ("events"."severity" between 0 and 3),
	CONSTRAINT "events_confidence_range" CHECK ("events"."confidence" between 0 and 1),
	CONSTRAINT "events_credibility_range" CHECK ("events"."credibility" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_ledger" (
	"date" date NOT NULL,
	"service" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors_429" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quota_ledger_date_service_pk" PRIMARY KEY("date","service")
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" "raw_source" NOT NULL,
	"feed" text NOT NULL,
	"external_id" text NOT NULL,
	"text" text NOT NULL,
	"url" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_meta" jsonb,
	"processed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"adapter" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_cursors_adapter_key_pk" PRIMARY KEY("adapter","key")
);
--> statement-breakpoint
CREATE TABLE "source_status" (
	"adapter" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"details" jsonb
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cells_snapshot_generated_at" ON "cells_snapshot" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "events_occurred_at" ON "events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "events_h3_cells" ON "events" USING gin ("h3_cells");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_source_external_id" ON "raw_items" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "raw_items_fetched_at" ON "raw_items" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "raw_items_unprocessed" ON "raw_items" USING btree ("processed") WHERE "raw_items"."processed" = false;