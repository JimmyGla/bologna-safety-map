ALTER TABLE "cells_snapshot" ADD COLUMN "forecast" jsonb;--> statement-breakpoint
ALTER TABLE "planned_events" ADD COLUMN "counter" boolean DEFAULT false NOT NULL;