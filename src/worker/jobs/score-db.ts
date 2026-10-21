import { gt, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { cellOverrides, cellsSnapshot, events, plannedEvents } from "@/db/schema";
import type { ScoredCell } from "@/lib/scoring";
import type { ScoreStore, SnapshotMeta } from "./score";

const KEEP_SNAPSHOTS_MS = 60 * 60_000; // an hour of history is plenty

export class DbScoreStore implements ScoreStore {
  async eventsSince(since: Date) {
    return db
      .select({
        eventType: events.eventType,
        credibility: events.credibility,
        confidence: events.confidence,
        occurredAt: events.occurredAt,
        h3Cells: events.h3Cells,
        sourceFeed: events.sourceFeed,
        sourceClass: events.sourceClass,
        extractor: events.extractor,
        source: events.source,
      })
      .from(events)
      .where(gte(events.occurredAt, since));
  }

  async plannedSince(since: Date) {
    return db
      .select({
        eventType: plannedEvents.eventType,
        startsAt: plannedEvents.startsAt,
        timeKnown: plannedEvents.timeKnown,
        locationNames: plannedEvents.locationNames,
        h3Cells: plannedEvents.h3Cells,
        sourceFeed: plannedEvents.sourceFeed,
        sourceClass: plannedEvents.sourceClass,
      })
      .from(plannedEvents)
      .where(gte(plannedEvents.startsAt, since));
  }

  async activeOverrides(now: Date) {
    return db
      .select({ h3: cellOverrides.h3, level: cellOverrides.level, expiresAt: cellOverrides.expiresAt })
      .from(cellOverrides)
      .where(gt(cellOverrides.expiresAt, now));
  }

  async saveSnapshot(generatedAt: Date, cells: ScoredCell[], meta: SnapshotMeta) {
    await db.insert(cellsSnapshot).values({ generatedAt, cells, reducedAccuracy: meta.reducedAccuracy, planned: meta.planned });
    await db.delete(cellsSnapshot).where(lt(cellsSnapshot.generatedAt, new Date(generatedAt.getTime() - KEEP_SNAPSHOTS_MS)));
  }
}
