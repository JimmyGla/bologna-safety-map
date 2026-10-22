import { gridDisk } from "h3-js";
import type { EventType, Extractor, RawSource, SourceClass } from "@/db/schema";
import type { DangerLevel } from "@/lib/danger-levels";
import { REPORT_WINDOW_MINUTES } from "@/lib/freshness";

// Per-cell danger levels from recent events (CLAUDE.md rules 2 and 3). Pure: the worker
// loads events/overrides and stores the result in cells_snapshot.
//
//   score = Σ weight[type] × credibility × confidence × exp(-age_minutes / 50)
//
// over events in the last 4h, then: thresholds → level, corroboration cap (rule 3),
// smoothing around level-4 cells, manual overrides last.

export const WINDOW_MINUTES = REPORT_WINDOW_MINUTES;
export const DECAY_MINUTES = 50;

// Violence against people weighs at least as much as clashes; organised (squad/hate)
// attacks the most, since they tend to repeat in the same area the same night.
export const TYPE_WEIGHTS: Record<EventType, number> = {
  hate_attack: 1.2,
  clashes: 1.0,
  sexual_violence: 1.0,
  assault: 0.9,
  vandalism: 0.6,
  blockade: 0.6,
  march: 0.5,
  police_presence: 0.3,
  aftermath: 0.25,
  peaceful_gathering: 0.2,
};

/** Upper bounds (exclusive) for levels 0..3; anything at or above the last is level 4. */
export type Thresholds = readonly [number, number, number, number];
export const DEFAULT_THRESHOLDS: Thresholds = [0.15, 0.4, 0.8, 1.4];

/** Without corroboration a cell can't go above this (rule 3). */
export const UNCORROBORATED_MAX: DangerLevel = 2;
/** Source classes that count as an official/news source for rule 3 (CLAUDE.md "Sources"). */
const AUTHORITATIVE: ReadonlySet<SourceClass> = new Set(["news", "official", "transit"]);

export type ScoringEvent = {
  eventType: EventType;
  credibility: number;
  confidence: number;
  occurredAt: Date;
  h3Cells: string[];
  /** Feed the event came from ("news:carlino"); distinct feeds = independent sources. */
  sourceFeed: string;
  sourceClass: SourceClass;
  /** Not used for the score; tells whether the window relies on the rules fallback. */
  extractor?: Extractor;
  source?: RawSource;
};

/**
 * True when events in the window came from the keyword extractor instead of an LLM.
 * TPER diversions are rule-based by design (deterministic, official) and don't count.
 */
export function isReducedAccuracy(events: ScoringEvent[]): boolean {
  return events.some((e) => e.extractor === "rules" && e.source !== "tper");
}

export type ScoringOverride = { h3: string; level: number; expiresAt: Date };

/** Aggregated, public data only — no text, URLs or author data (rule 1). */
export type ScoredCell = {
  h3: string;
  level: DangerLevel;
  score: number;
  eventTypes: EventType[];
  sourceCount: number;
  officialSource: boolean;
  lastReportAt: string | null;
  overridden: boolean;
};

export function decay(ageMinutes: number): number {
  return Math.exp(-Math.max(0, ageMinutes) / DECAY_MINUTES);
}

export function levelFor(score: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): DangerLevel {
  const i = thresholds.findIndex((t) => score < t);
  return (i === -1 ? 4 : i) as DangerLevel;
}

type Acc = { score: number; types: Set<EventType>; feeds: Set<string>; authoritative: boolean; last: number };

export function scoreCells(
  events: ScoringEvent[],
  overrides: ScoringOverride[],
  now: Date,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ScoredCell[] {
  const t = now.getTime();
  const acc = new Map<string, Acc>();

  for (const e of events) {
    const ageMin = (t - e.occurredAt.getTime()) / 60_000;
    if (ageMin > WINDOW_MINUTES) continue;
    const contribution = TYPE_WEIGHTS[e.eventType] * e.credibility * e.confidence * decay(ageMin);
    for (const h3 of new Set(e.h3Cells)) {
      let a = acc.get(h3);
      if (!a) acc.set(h3, (a = { score: 0, types: new Set(), feeds: new Set(), authoritative: false, last: 0 }));
      a.score += contribution;
      a.types.add(e.eventType);
      a.feeds.add(e.sourceFeed);
      a.authoritative ||= AUTHORITATIVE.has(e.sourceClass);
      a.last = Math.max(a.last, Math.min(t, e.occurredAt.getTime()));
    }
  }

  const cells = new Map<string, ScoredCell>();
  for (const [h3, a] of acc) {
    let level = levelFor(a.score, thresholds);
    // Rule 3: level 3+ needs ≥2 independent sources or ≥1 official/news source.
    if (level > UNCORROBORATED_MAX && a.feeds.size < 2 && !a.authoritative) level = UNCORROBORATED_MAX;
    cells.set(h3, {
      h3,
      level,
      score: Math.round(a.score * 1000) / 1000,
      eventTypes: [...a.types].sort(),
      sourceCount: a.feeds.size,
      officialSource: a.authoritative,
      lastReportAt: new Date(a.last).toISOString(),
      overridden: false,
    });
  }

  // Smoothing: neighbours of a level-4 cell are at least level 1.
  const severe = [...cells.values()].filter((c) => c.level === 4).map((c) => c.h3);
  for (const h3 of severe) {
    for (const n of gridDisk(h3, 1)) {
      const c = cells.get(n);
      if (c) c.level = Math.max(c.level, 1) as DangerLevel;
      else cells.set(n, emptyCell(n, 1));
    }
  }

  // Manual overrides win over everything, including the cap.
  for (const o of overrides) {
    if (o.expiresAt.getTime() <= t) continue;
    const c = cells.get(o.h3) ?? emptyCell(o.h3, 0);
    c.level = Math.min(4, Math.max(0, Math.round(o.level))) as DangerLevel;
    c.overridden = true;
    cells.set(o.h3, c);
  }

  return [...cells.values()].sort((a, b) => a.h3.localeCompare(b.h3));
}

function emptyCell(h3: string, level: DangerLevel): ScoredCell {
  return { h3, level, score: 0, eventTypes: [], sourceCount: 0, officialSource: false, lastReportAt: null, overridden: false };
}

/** Parses "0.15,0.4,0.8,1.4"; must be 4 increasing positive numbers. */
export function parseThresholds(s: string): Thresholds | string {
  const parts = s.split(",").map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    return `SCORE_THRESHOLDS must be 4 positive numbers, got "${s}"`;
  }
  if (parts.some((n, i) => i > 0 && n <= parts[i - 1])) return `SCORE_THRESHOLDS must be increasing, got "${s}"`;
  return parts as unknown as Thresholds;
}
