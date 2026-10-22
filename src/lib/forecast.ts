import { z } from "zod";
import { romeParts, romeTime } from "@/lib/dates";
import type { UpcomingEvent } from "@/lib/planned";

// Expected-risk forecast for the next 72h: public shape, time blocks and event windows.
// Client-safe (zod + pure functions); the model itself is src/lib/forecast-model.ts.
//
// A forecast is an ESTIMATE, never a danger level: it has its own levels, palette and map
// mode, and it never changes the current map (CLAUDE.md "Forecast").

export const FORECAST_HOURS = 72;
export const BLOCK_HOURS = 6;

/** Forecast levels 1..4 (0 = nothing expected, not sent). Violet, never the danger colours. */
export const FORECAST_LEVELS = [
  { level: 1, hex: "#ddd6fe", outline: "#a78bfa" },
  { level: 2, hex: "#a78bfa", outline: "#7c3aed" },
  { level: 3, hex: "#7c3aed", outline: "#5b21b6" },
  { level: 4, hex: "#4c1d95", outline: "#2e1065" },
] as const;

const h3 = z.string().regex(/^[0-9a-f]{15}$/);

export const forecastCellSchema = z
  .object({
    h3,
    /** Level per block (same order as `blocks`), 0..4. */
    levels: z.array(z.number().int().min(0).max(4)),
    /** Announced events (UpcomingEvent ids) that raise this cell. */
    eventIds: z.array(z.string()),
    /** An announced event here is opposed by, or opposes, another one nearby at the same time. */
    counter: z.boolean(),
    /** Violent incidents reported in or next to this cell in the last 7 days. */
    recentIncidents: z.number().int().min(0),
  })
  .strict();
export type ForecastCell = z.infer<typeof forecastCellSchema>;

export const forecastSchema = z
  .object({
    generatedAt: z.string().datetime(),
    blocks: z.array(z.object({ start: z.string().datetime(), end: z.string().datetime() }).strict()),
    cells: z.array(forecastCellSchema),
  })
  .strict();
export type Forecast = z.infer<typeof forecastSchema>;

/** /api/forecast: the forecast plus hexagons with one property per block (l0, l1, …). */
export const forecastResponseSchema = z
  .object({
    forecast: forecastSchema.nullable(),
    geojson: z
      .object({
        type: z.literal("FeatureCollection"),
        features: z.array(
          z
            .object({
              type: z.literal("Feature"),
              properties: z.record(z.string(), z.union([z.string(), z.number()])),
              geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }).strict(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;

export const blockKey = (i: number) => `l${i}`;

export type Block = { start: Date; end: Date };

/**
 * 6-hour blocks on Rome's clock (00–06, 06–12, 12–18, 18–24), from the one containing `now`
 * until the horizon is covered. DST-aware: a block can be 5 or 7 hours on change nights.
 */
export function forecastBlocks(now: Date, hours = FORECAST_HOURS): Block[] {
  const p = romeParts(now);
  const until = now.getTime() + hours * 3_600_000;
  const base = Math.floor(p.h / BLOCK_HOURS) * BLOCK_HOURS;
  const blocks: Block[] = [];
  // romeTime() accepts hours past 23 (they roll into the next days, on Rome's clock).
  for (let i = 0; ; i++) {
    const start = romeTime(p.y, p.m, p.d, base + BLOCK_HOURS * i);
    if (start.getTime() >= until) break;
    blocks.push({ start, end: romeTime(p.y, p.m, p.d, base + BLOCK_HOURS * (i + 1)) });
  }
  return blocks;
}

/** Hours before/after an announced start that an event is expected to affect the area. */
export const BEFORE_START_H = 1;
export const AFTER_START_H = 4;
/** Day-only announcements: assume the daytime/evening of that day. */
const DAY_ONLY_FROM_H = 9;

/** When an announced event is expected to affect its area. */
export function eventWindow(e: Pick<UpcomingEvent, "startsAt" | "timeKnown">): Block {
  const start = new Date(e.startsAt);
  if (e.timeKnown) {
    return {
      start: new Date(start.getTime() - BEFORE_START_H * 3_600_000),
      end: new Date(start.getTime() + AFTER_START_H * 3_600_000),
    };
  }
  const p = romeParts(start);
  return { start: romeTime(p.y, p.m, p.d, DAY_ONLY_FROM_H), end: romeTime(p.y, p.m, p.d + 1, 0) };
}

/** Hours two time ranges overlap (0 if they don't). */
export function overlapHours(a: Block, b: Block): number {
  return Math.max(0, (Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime())) / 3_600_000);
}
