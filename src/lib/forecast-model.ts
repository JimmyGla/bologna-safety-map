import { gridDisk } from "h3-js";
import type { SourceClass } from "@/db/schema";
import type { EventType } from "@/lib/event-types";
import { eventWindow, forecastBlocks, overlapHours, type Block, type Forecast, type ForecastCell } from "@/lib/forecast";
import type { UpcomingEvent } from "@/lib/planned";
import { DEFAULT_THRESHOLDS, TYPE_WEIGHTS, type Thresholds } from "@/lib/scoring";

// Expected risk per cell and 6-hour block for the next 72h. Pure; the worker runs it with the
// scoring job and stores the result in cells_snapshot.forecast.
//
// For each block and cell:
//   announced = Σ over announced events active in the block:
//                 weight[type] × reliability × timing × counter × history × spread(distance)
//   history   = recent violent incidents around the cell, decaying with time (recurrence)
//   level     = thresholds(announced + history), capped at 2 when no announced event
//               contributes (history alone is a weak predictor — the same spirit as rule 3)

/** Violent incidents that make an area more likely to see violence again. */
export const VIOLENT_TYPES: ReadonlySet<EventType> = new Set(["clashes", "assault", "hate_attack", "sexual_violence", "vandalism"]);
export const HISTORY_DAYS = 7;
const HISTORY_DECAY_H = 48;
/** History alone counts for less than an announcement and fades further ahead. */
const HISTORY_WEIGHT = 0.5;
const HISTORY_ONLY_MAX_LEVEL = 2;

/** Recurring calls ("ogni sabato") are intentions, not confirmed events. */
const RECURRING_FACTOR = 0.5;
/** Day-only announcements: we don't know when, so less certain within any one block. */
const DAY_ONLY_FACTOR = 0.6;
/**
 * A declared counter-event near another gathering at the same time is the strongest
 * escalation signal. Mere proximity (two unrelated marches) only raises it a little.
 */
const CONCURRENT_FACTOR = 1.2;
const COUNTER_FACTOR = 2.0;
/** "Near": within this many cells (~1.4 km at res 9). */
const NEAR_K = 4;
/** Spread around an event's own cells: marches move, crowds disperse. */
const SPREAD = [1, 0.5, 0.25];

export type HistoryEvent = {
  eventType: EventType;
  credibility: number;
  confidence: number;
  occurredAt: Date;
  h3Cells: string[];
  sourceFeed: string;
  sourceClass: SourceClass;
};

/** How far to trust an (already corroborated) announcement. */
function reliability(e: UpcomingEvent): number {
  const base = e.officialSource ? 1 : Math.min(0.9, 0.5 + 0.1 * e.sourceCount);
  return e.recurring ? base * RECURRING_FACTOR : base;
}

/** Cells within `k` of any of `cells`, mapped to their distance. */
function rings(cells: string[], k: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) {
    for (let d = 0; d <= k; d++) {
      for (const n of gridDisk(c, d)) if (!out.has(n) || out.get(n)! > d) out.set(n, d);
    }
  }
  return out;
}

type Incident = { weight: number; count: number };

/** Recent violent incidents per cell (own cells + half weight on neighbours). */
function incidentsByCell(history: HistoryEvent[], now: Date): Map<string, Incident> {
  const out = new Map<string, Incident>();
  for (const e of history) {
    if (!VIOLENT_TYPES.has(e.eventType)) continue;
    const ageH = Math.max(0, (now.getTime() - e.occurredAt.getTime()) / 3_600_000);
    if (ageH > HISTORY_DAYS * 24) continue;
    const w = TYPE_WEIGHTS[e.eventType] * e.credibility * e.confidence * Math.exp(-ageH / HISTORY_DECAY_H);
    for (const [cell, d] of rings(e.h3Cells, 1)) {
      const inc = out.get(cell) ?? { weight: 0, count: 0 };
      inc.weight += d === 0 ? w : w / 2;
      inc.count++;
      out.set(cell, inc);
    }
  }
  return out;
}

function levelOf(score: number, t: Thresholds): number {
  const i = t.findIndex((x) => score < x);
  return i === -1 ? 4 : i;
}

export function buildForecast(
  upcoming: UpcomingEvent[],
  history: HistoryEvent[],
  now: Date,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Forecast {
  const blocks = forecastBlocks(now);
  const horizon: Block = { start: blocks[0].start, end: blocks[blocks.length - 1].end };
  const events = upcoming.filter((e) => overlapHours(eventWindow(e), horizon) > 0);
  const incidents = incidentsByCell(history, now);

  // Per event: windows, spread and multipliers (computed once).
  const prepared = events.map((e) => ({ e, window: eventWindow(e), spread: rings(e.h3Cells, SPREAD.length - 1), near: rings(e.h3Cells, NEAR_K) }));
  const scored = prepared.map((p) => {
    // Other gatherings nearby at the same time; worse when either is a declared counter-event.
    const concurrent = prepared.filter(
      (q) => q !== p && overlapHours(p.window, q.window) > 0 && q.e.h3Cells.some((c) => p.near.has(c)),
    );
    const opposed = concurrent.length > 0;
    const declared = opposed && (p.e.counter || concurrent.some((q) => q.e.counter));
    const conflict = declared ? COUNTER_FACTOR : opposed || p.e.counter ? CONCURRENT_FACTOR : 1;
    // Past violence on or next to the route makes it more likely to repeat.
    const pastWeight = p.e.h3Cells.reduce((s, c) => s + (incidents.get(c)?.weight ?? 0), 0);
    const historyFactor = 1 + Math.min(1, pastWeight);
    const base = TYPE_WEIGHTS[p.e.eventType] * reliability(p.e) * (p.e.timeKnown ? 1 : DAY_ONLY_FACTOR) * conflict * historyFactor;
    return { ...p, base, conflicted: opposed || p.e.counter };
  });

  type Acc = { announced: number[]; history: number[]; eventIds: Set<string>; counter: boolean };
  const cells = new Map<string, Acc>();
  const acc = (h3: string) => {
    let a = cells.get(h3);
    if (!a) {
      a = { announced: blocks.map(() => 0), history: blocks.map(() => 0), eventIds: new Set(), counter: false };
      cells.set(h3, a);
    }
    return a;
  };

  for (const s of scored) {
    blocks.forEach((b, i) => {
      const hours = overlapHours(s.window, b);
      if (!hours) return;
      // Any overlap counts at least half: an event at 17:30 matters for the 18–24 block too.
      const timing = Math.max(0.5, Math.min(1, hours / Math.min(3, (b.end.getTime() - b.start.getTime()) / 3_600_000)));
      for (const [h3, d] of s.spread) {
        const a = acc(h3);
        a.announced[i] += s.base * timing * SPREAD[d];
        a.eventIds.add(s.e.id);
        a.counter ||= s.conflicted;
      }
    });
  }

  for (const [h3, inc] of incidents) {
    blocks.forEach((b, i) => {
      const aheadH = Math.max(0, (b.start.getTime() + (b.end.getTime() - b.start.getTime()) / 2 - now.getTime()) / 3_600_000);
      acc(h3).history[i] += HISTORY_WEIGHT * inc.weight * Math.exp(-aheadH / HISTORY_DECAY_H);
    });
  }

  const out: ForecastCell[] = [];
  for (const [h3, a] of cells) {
    const levels = blocks.map((_, i) => {
      const level = levelOf(a.announced[i] + a.history[i], thresholds);
      return a.announced[i] > 0 ? level : Math.min(level, HISTORY_ONLY_MAX_LEVEL);
    });
    if (!levels.some((l) => l > 0)) continue;
    out.push({ h3, levels, eventIds: [...a.eventIds].sort(), counter: a.counter, recentIncidents: incidents.get(h3)?.count ?? 0 });
  }

  return {
    generatedAt: now.toISOString(),
    blocks: blocks.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
    cells: out.sort((x, y) => x.h3.localeCompare(y.h3)),
  };
}
