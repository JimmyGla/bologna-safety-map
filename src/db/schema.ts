// Drizzle schema.
// CLAUDE.md rule 1: raw_items is the only table holding post text, and it is purged after
// 24h (src/worker/jobs/purge.ts). No table stores handles, names or profile links.
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { GeocodeResult } from "@/lib/gazetteer/nominatim";
import type { Forecast } from "@/lib/forecast";
import type { UpcomingEvent } from "@/lib/planned";
import type { ScoredCell } from "@/lib/scoring";

export const RAW_SOURCES = ["news", "tper", "official", "bluesky", "mastodon", "reddit", "telegram"] as const;
import { EVENT_TYPES } from "@/lib/event-types";

export { EVENT_TYPES };
export const SOURCE_CLASSES = ["social", "news", "official", "transit"] as const;
export const EXTRACTORS = ["gemini", "ollama", "rules"] as const;

export const rawSource = pgEnum("raw_source", RAW_SOURCES);
export const eventType = pgEnum("event_type", EVENT_TYPES);
export const sourceClass = pgEnum("source_class", SOURCE_CLASSES);
export const extractor = pgEnum("extractor", EXTRACTORS);

export type RawSource = (typeof RAW_SOURCES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type SourceClass = (typeof SOURCE_CLASSES)[number];
export type Extractor = (typeof EXTRACTORS)[number];

/** Coarse account signals only — never a handle, name or profile link. */
export type AuthorMeta = { follower_count?: number; account_age_days?: number };

const tz = { withTimezone: true } as const;

export const rawItems = pgTable(
  "raw_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: rawSource("source").notNull(),
    /** Which feed/channel within the source (e.g. "carlino"); sources are counted per feed for corroboration. */
    feed: text("feed").notNull(),
    externalId: text("external_id").notNull(),
    text: text("text").notNull(),
    url: text("url"),
    publishedAt: timestamp("published_at", tz),
    fetchedAt: timestamp("fetched_at", tz).notNull().defaultNow(),
    authorMeta: jsonb("author_meta").$type<AuthorMeta>(),
    /** Pseudonymous per-day author key (src/worker/ingest/author-key.ts); null for news/official. */
    authorKey: text("author_key"),
    processed: boolean("processed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("raw_items_source_external_id").on(t.source, t.externalId),
    index("raw_items_fetched_at").on(t.fetchedAt),
    index("raw_items_unprocessed").on(t.processed).where(sql`${t.processed} = false`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Raw items are purged after 24h; events outlive them.
    rawItemId: bigint("raw_item_id", { mode: "number" }).references(() => rawItems.id, { onDelete: "set null" }),
    // Copied from the raw item so corroboration (rule 3) still works after the purge.
    source: rawSource("source").notNull(),
    sourceFeed: text("source_feed").notNull(),
    /** Pseudonymous author key (independent people for rule 3); nulled after 24h by the purge. */
    authorKey: text("author_key"),
    eventType: eventType("event_type").notNull(),
    severity: smallint("severity").notNull(),
    confidence: real("confidence").notNull(),
    isFirsthand: boolean("is_firsthand").notNull().default(false),
    credibility: real("credibility").notNull(),
    occurredAt: timestamp("occurred_at", tz).notNull(),
    locationNames: text("location_names").array().notNull().default(sql`'{}'::text[]`),
    h3Cells: text("h3_cells").array().notNull().default(sql`'{}'::text[]`),
    sourceClass: sourceClass("source_class").notNull(),
    extractor: extractor("extractor").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("events_severity_range", sql`${t.severity} between 0 and 3`),
    check("events_confidence_range", sql`${t.confidence} between 0 and 1`),
    check("events_credibility_range", sql`${t.credibility} between 0 and 1`),
    index("events_occurred_at").on(t.occurredAt),
    index("events_h3_cells").using("gin", t.h3Cells),
  ],
);

/**
 * Announced future protests ("sabato corteo alle 15 da piazza XX Settembre"), one row per
 * report. Kept apart from `events`: an announcement never changes a cell's danger level.
 * Grouped and corroboration-gated into `cells_snapshot.planned` by the scoring job.
 */
export const plannedEvents = pgTable(
  "planned_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawItemId: bigint("raw_item_id", { mode: "number" }).references(() => rawItems.id, { onDelete: "set null" }),
    source: rawSource("source").notNull(),
    sourceFeed: text("source_feed").notNull(),
    /** Pseudonymous author key; nulled after 24h by the purge. */
    authorKey: text("author_key"),
    eventType: eventType("event_type").notNull(),
    startsAt: timestamp("starts_at", tz).notNull(),
    /** false when only the day is known. */
    timeKnown: boolean("time_known").notNull().default(false),
    /** Announced against another event (contromanifestazione). */
    counter: boolean("counter").notNull().default(false),
    /** From a recurring call ("ogni sabato"): the next occurrence, lower confidence. */
    recurring: boolean("recurring").notNull().default(false),
    locationNames: text("location_names").array().notNull().default(sql`'{}'::text[]`),
    h3Cells: text("h3_cells").array().notNull().default(sql`'{}'::text[]`),
    sourceClass: sourceClass("source_class").notNull(),
    extractor: extractor("extractor").notNull(),
    confidence: real("confidence").notNull(),
    credibility: real("credibility").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("planned_events_starts_at").on(t.startsAt)],
);

/** Manual level for a cell (e.g. confirmed by phone), until it expires. */
export const cellOverrides = pgTable(
  "cell_overrides",
  {
    h3: text("h3").primaryKey(),
    level: smallint("level").notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [check("cell_overrides_level_range", sql`${t.level} between 0 and 4`)],
);

/** Daily request counts per external service, shared by all worker runs (CLAUDE.md rule 5). */
export const quotaLedger = pgTable(
  "quota_ledger",
  {
    date: date("date", { mode: "string" }).notNull(),
    service: text("service").notNull(),
    requests: integer("requests").notNull().default(0),
    errors429: integer("errors_429").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.service] })],
);

/** Where each adapter left off (Bluesky last-seen time, Mastodon since_id, Telegram message id). */
export const sourceCursors = pgTable(
  "source_cursors",
  {
    adapter: text("adapter").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adapter, t.key] })],
);

/** Last run of each source adapter, for /admin. */
export const sourceStatus = pgTable("source_status", {
  adapter: text("adapter").primaryKey(),
  status: text("status", { enum: ["ok", "error", "disabled"] }).notNull(),
  lastRunAt: timestamp("last_run_at", tz).notNull(),
  lastSuccessAt: timestamp("last_success_at", tz),
  fetched: integer("fetched").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  /** Error class and message only; never item text. */
  lastError: text("last_error"),
  /** Adapter-specific counters, e.g. extraction: { provider, byExtractor, fallbacks }. */
  details: jsonb("details").$type<Record<string, unknown>>(),
});

/**
 * Scored cells, computed by the worker every minute; /api/cells serves the latest row.
 * `cells` holds aggregated per-cell data only (ScoredCell): no text, URLs or authors.
 */
export const cellsSnapshot = pgTable(
  "cells_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    generatedAt: timestamp("generated_at", tz).notNull(),
    cells: jsonb("cells").$type<ScoredCell[]>().notNull(),
    /** Some events in the window were extracted by the rules fallback (public badge). */
    reducedAccuracy: boolean("reduced_accuracy").notNull().default(false),
    /** Upcoming announced protests (grouped, corroborated). Aggregated data only. */
    planned: jsonb("planned").$type<UpcomingEvent[]>().notNull().default(sql`'[]'::jsonb`),
    /** Expected-risk forecast for the next 72h (src/lib/forecast-model.ts). Aggregated data only. */
    forecast: jsonb("forecast").$type<Forecast>(),
  },
  (t) => [index("cells_snapshot_generated_at").on(t.generatedAt)],
);

/** Nominatim results by normalized place phrase. `result` null = known miss. */
export const geocodeCache = pgTable("geocode_cache", {
  query: text("query").primaryKey(),
  result: jsonb("result").$type<GeocodeResult | null>(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});
