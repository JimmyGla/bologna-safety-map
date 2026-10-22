import { isReducedAccuracy, scoreCells, WINDOW_MINUTES, type ScoredCell, type ScoringEvent, type ScoringOverride, type Thresholds } from "@/lib/scoring";
import { errInfo, logger } from "@/lib/log";
import type { Forecast } from "@/lib/forecast";
import { buildForecast, HISTORY_DAYS } from "@/lib/forecast-model";
import { groupUpcoming, KEEP_AFTER_START_MS, type PlannedRow, type UpcomingEvent } from "@/lib/planned";

const slog = logger("score");

// Scoring job (every minute): recent events + active overrides → cells_snapshot, plus the
// 72h forecast from announcements and the last 7 days of incidents.

export const SCORE_SCHEDULE = "* * * * *";

export interface ScoreStore {
  eventsSince(since: Date): Promise<ScoringEvent[]>;
  activeOverrides(now: Date): Promise<ScoringOverride[]>;
  /** Announced events starting after `since`. */
  plannedSince(since: Date): Promise<PlannedRow[]>;
  saveSnapshot(generatedAt: Date, cells: ScoredCell[], meta: SnapshotMeta): Promise<void>;
  /** Statistical archive: keeps the higher of the stored and given level per cell for this hour. */
  archiveLevels(hour: Date, levels: { h3: string; level: number }[]): Promise<void>;
}

export type SnapshotMeta = { reducedAccuracy: boolean; planned: UpcomingEvent[]; forecast: Forecast };

/** For dry runs and tests: scores whatever events the in-memory ingest store holds. */
export class MemoryScoreStore implements ScoreStore {
  snapshots: ({ generatedAt: Date; cells: ScoredCell[] } & SnapshotMeta)[] = [];
  constructor(
    private events: () => ScoringEvent[],
    private overrides: ScoringOverride[] = [],
    private planned: () => PlannedRow[] = () => [],
  ) {}
  async plannedSince(since: Date) {
    return this.planned().filter((p) => p.startsAt >= since);
  }
  async eventsSince(since: Date) {
    return this.events().filter((e) => e.occurredAt >= since);
  }
  async activeOverrides(now: Date) {
    return this.overrides.filter((o) => o.expiresAt > now);
  }
  async saveSnapshot(generatedAt: Date, cells: ScoredCell[], meta: SnapshotMeta) {
    this.snapshots.push({ generatedAt, cells, ...meta });
  }
  levels = new Map<string, number>();
  async archiveLevels(hour: Date, levels: { h3: string; level: number }[]) {
    for (const l of levels) {
      const key = hour.toISOString() + "|" + l.h3;
      this.levels.set(key, Math.max(this.levels.get(key) ?? 0, l.level));
    }
  }
}

/** One scoring pass. Never throws. */
export async function runScoring(store: ScoreStore, thresholds: Thresholds, now: () => Date = () => new Date()) {
  const at = now();
  try {
    const since = new Date(at.getTime() - WINDOW_MINUTES * 60_000);
    // One query for both: the scoring window (4h) is inside the forecast history (7 days).
    const [history, overrides, plannedRows] = await Promise.all([
      store.eventsSince(new Date(at.getTime() - HISTORY_DAYS * 86_400_000)),
      store.activeOverrides(at),
      store.plannedSince(new Date(at.getTime() - KEEP_AFTER_START_MS)),
    ]);
    const events = history.filter((e) => e.occurredAt.getTime() >= since.getTime());
    const cells = scoreCells(events, overrides, at, thresholds);
    const reducedAccuracy = isReducedAccuracy(events);
    const planned = groupUpcoming(plannedRows, at);
    const forecast = buildForecast(planned, history, at, thresholds);
    await store.saveSnapshot(at, cells, { reducedAccuracy, planned, forecast });
    // What the map showed, per hour, for the statistical archive. A failure here must not
    // affect the live map.
    const shown = cells.filter((c) => c.level > 0).map((c) => ({ h3: c.h3, level: c.level }));
    if (shown.length) {
      await store
        .archiveLevels(new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000), shown)
        .catch((err: Error) => slog.warn(errInfo(err), "could not archive levels"));
    }
    const byLevel = [0, 1, 2, 3, 4].map((l) => cells.filter((c) => c.level === l).length);
    slog.info({ events: events.length, cells: cells.length, byLevel, reducedAccuracy, upcoming: planned.length, forecastCells: forecast.cells.length }, "snapshot saved");
    return cells;
  } catch (err) {
    slog.error(errInfo(err), "scoring failed");
    return null;
  }
}
