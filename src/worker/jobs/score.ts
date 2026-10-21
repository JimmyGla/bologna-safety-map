import { isReducedAccuracy, scoreCells, WINDOW_MINUTES, type ScoredCell, type ScoringEvent, type ScoringOverride, type Thresholds } from "@/lib/scoring";
import { errInfo, logger } from "@/lib/log";
import { groupUpcoming, KEEP_AFTER_START_MS, type PlannedRow, type UpcomingEvent } from "@/lib/planned";

const slog = logger("score");

// Scoring job (every minute): recent events + active overrides → cells_snapshot.

export const SCORE_SCHEDULE = "* * * * *";

export interface ScoreStore {
  eventsSince(since: Date): Promise<ScoringEvent[]>;
  activeOverrides(now: Date): Promise<ScoringOverride[]>;
  /** Announced events starting after `since`. */
  plannedSince(since: Date): Promise<PlannedRow[]>;
  saveSnapshot(generatedAt: Date, cells: ScoredCell[], meta: SnapshotMeta): Promise<void>;
}

export type SnapshotMeta = { reducedAccuracy: boolean; planned: UpcomingEvent[] };

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
}

/** One scoring pass. Never throws. */
export async function runScoring(store: ScoreStore, thresholds: Thresholds, now: () => Date = () => new Date()) {
  const at = now();
  try {
    const since = new Date(at.getTime() - WINDOW_MINUTES * 60_000);
    const [events, overrides, plannedRows] = await Promise.all([
      store.eventsSince(since),
      store.activeOverrides(at),
      store.plannedSince(new Date(at.getTime() - KEEP_AFTER_START_MS)),
    ]);
    const cells = scoreCells(events, overrides, at, thresholds);
    const recent = events.filter((e) => e.occurredAt.getTime() >= since.getTime());
    const reducedAccuracy = isReducedAccuracy(recent);
    const planned = groupUpcoming(plannedRows, at);
    await store.saveSnapshot(at, cells, { reducedAccuracy, planned });
    const byLevel = [0, 1, 2, 3, 4].map((l) => cells.filter((c) => c.level === l).length);
    slog.info({ events: events.length, cells: cells.length, byLevel, reducedAccuracy, upcoming: planned.length }, "snapshot saved");
    return cells;
  } catch (err) {
    slog.error(errInfo(err), "scoring failed");
    return null;
  }
}
