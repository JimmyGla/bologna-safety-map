import { z } from "zod";
import type { SourceClass } from "@/db/schema";
import { romeDay } from "@/lib/dates";
import { EVENT_TYPES, type EventType } from "@/lib/event-types";

// Announced future protests: grouping, corroboration and the public /api/planned shape.
// Client-safe (types + zod + pure functions). Never affects danger levels.

export const UPCOMING_DAYS = 7;
/** An announced event stays listed this long after its start. */
export const KEEP_AFTER_START_MS = 12 * 3_600_000;
/** Reports of the same day and place whose times differ by more than this are separate events. */
const SAME_EVENT_MS = 2 * 3_600_000;

const AUTHORITATIVE: ReadonlySet<SourceClass> = new Set(["news", "official", "transit"]);

export type PlannedRow = {
  eventType: EventType;
  startsAt: Date;
  timeKnown: boolean;
  /** Announced against another event. */
  counter?: boolean;
  locationNames: string[];
  h3Cells: string[];
  sourceFeed: string;
  /** Pseudonymous author key of a social post (distinct people count as independent). */
  authorKey?: string | null;
  sourceClass: SourceClass;
};

export const upcomingEventSchema = z
  .object({
    id: z.string(),
    eventType: z.enum(EVENT_TYPES),
    startsAt: z.string().datetime(),
    timeKnown: z.boolean(),
    locationNames: z.array(z.string()),
    h3Cells: z.array(z.string().regex(/^[0-9a-f]{15}$/)),
    /** Distinct feeds reporting it. */
    sourceCount: z.number().int().min(1),
    /** At least one news, official or transit source. */
    officialSource: z.boolean(),
    /** Announced against another event (contromanifestazione). */
    counter: z.boolean().default(false),
  })
  .strict();
export type UpcomingEvent = z.infer<typeof upcomingEventSchema>;

/** Dashed outlines for the map: one hexagon per cell, tagged with its event id. */
export const upcomingOutlineSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z
        .object({
          type: z.literal("Feature"),
          properties: z.object({ h3: z.string(), eventId: z.string() }).strict(),
          geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }).strict(),
        })
        .strict(),
    ),
  })
  .strict();

export const upcomingResponseSchema = z
  .object({ generatedAt: z.string().datetime().nullable(), events: z.array(upcomingEventSchema), outline: upcomingOutlineSchema })
  .strict();
export type UpcomingResponse = z.infer<typeof upcomingResponseSchema>;

type Group = { rows: PlannedRow[]; day: string; cells: Set<string>; start: number; timeKnown: boolean };

function sameEvent(g: Group, r: PlannedRow): boolean {
  if (g.day !== romeDay(r.startsAt)) return false;
  if (!r.h3Cells.some((c) => g.cells.has(c))) return false;
  // Unknown times can merge with anything that day and place.
  return !g.timeKnown || !r.timeKnown || Math.abs(g.start - r.startsAt.getTime()) <= SAME_EVENT_MS;
}

/**
 * Upcoming events for the public list: reports of the same event merged, then the
 * corroboration gate (CLAUDE.md rule 3, applied to announcements): shown only with ≥1
 * news/official/transit source or ≥2 independent feeds.
 */
export function groupUpcoming(rows: PlannedRow[], now: Date, days = UPCOMING_DAYS): UpcomingEvent[] {
  const from = now.getTime() - KEEP_AFTER_START_MS;
  const to = now.getTime() + days * 86_400_000;
  const inWindow = rows
    .filter((r) => r.h3Cells.length && r.startsAt.getTime() >= from && r.startsAt.getTime() <= to)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const groups: Group[] = [];
  for (const r of inWindow) {
    const g = groups.find((x) => sameEvent(x, r));
    if (!g) {
      groups.push({ rows: [r], day: romeDay(r.startsAt), cells: new Set(r.h3Cells), start: r.startsAt.getTime(), timeKnown: r.timeKnown });
      continue;
    }
    g.rows.push(r);
    for (const c of r.h3Cells) g.cells.add(c);
    // Prefer a known time over a day-only one.
    if (r.timeKnown && !g.timeKnown) {
      g.start = r.startsAt.getTime();
      g.timeKnown = true;
    }
  }

  return groups
    .map((g): UpcomingEvent | null => {
      // Independent sources: distinct people (author keys) or distinct feeds, as for current events.
      const feeds = new Set(g.rows.map((r) => r.authorKey || r.sourceFeed));
      const official = g.rows.some((r) => AUTHORITATIVE.has(r.sourceClass));
      if (feeds.size < 2 && !official) return null;
      // Event type: what authoritative sources say, else the most common.
      const pool = official ? g.rows.filter((r) => AUTHORITATIVE.has(r.sourceClass)) : g.rows;
      const counts = new Map<EventType, number>();
      for (const r of pool) counts.set(r.eventType, (counts.get(r.eventType) ?? 0) + 1);
      const eventType = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const cells = [...g.cells].sort();
      return {
        id: `${g.day}-${cells[0]}`,
        eventType,
        startsAt: new Date(g.start).toISOString(),
        timeKnown: g.timeKnown,
        locationNames: [...new Set(g.rows.flatMap((r) => r.locationNames))],
        h3Cells: cells,
        sourceCount: feeds.size,
        officialSource: official,
        counter: g.rows.some((r) => r.counter),
      };
    })
    .filter((e): e is UpcomingEvent => e !== null)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
