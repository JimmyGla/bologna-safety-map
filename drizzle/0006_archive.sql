CREATE TABLE "archive_levels" (
	"hour" timestamp with time zone NOT NULL,
	"h3" text NOT NULL,
	"max_level" smallint NOT NULL,
	CONSTRAINT "archive_levels_hour_h3_pk" PRIMARY KEY("hour","h3")
);
--> statement-breakpoint
CREATE TABLE "archived_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_event_id" bigint NOT NULL,
	"period" timestamp with time zone NOT NULL,
	"precision" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"severity" smallint NOT NULL,
	"source_class" "source_class" NOT NULL,
	"extractor" "extractor" NOT NULL,
	"quartieri" text[] DEFAULT '{}'::text[] NOT NULL,
	"h3_cells" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "archive_levels_hour" ON "archive_levels" USING btree ("hour");--> statement-breakpoint
CREATE UNIQUE INDEX "archived_events_source_event_id" ON "archived_events" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "archived_events_period" ON "archived_events" USING btree ("period");