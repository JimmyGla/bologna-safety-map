import { isReducedAccuracy, scoreCells, WINDOW_MINUTES, type ScoredCell, type ScoringEvent, type ScoringOverride, type Thresholds } from "@/lib/scoring";
import { errInfo, logger } from "@/lib/log";

const slog = logger("score");

// Scoring job (every minute): recent events + active overrides → cells_snapshot.

export const SCORE_SCHEDULE = "* * * * *";

export interface ScoreStore {
  eventsSince(since: Date): Promise<ScoringEvent[]>;
  activeOverrides(now: Date): Promise<ScoringOverride[]>;
  saveSnapshot(generatedAt: Date, cells: ScoredCell[], meta: SnapshotMeta): Promise<void>;
}

export type SnapshotMeta = { reducedAccuracy: boolean };

/** For dry runs and tests: scores whatever events the in-memory ingest store holds. */
export class MemoryScoreStore implements ScoreStore {
  snapshots: ({ generatedAt: Date; cells: ScoredCell[] } & SnapshotMeta)[] = [];
  constructor(
    private events: () => ScoringEvent[],
    private overrides: ScoringOverride[] = [],
  ) {}
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
    const [events, overrides] = await Promise.all([store.eventsSince(since), store.activeOverrides(at)]);
    const cells = scoreCells(events, overrides, at, thresholds);
    const recent = events.filter((e) => e.occurredAt.getTime() >= since.getTime());
    const reducedAccuracy = isReducedAccuracy(recent);
    await store.saveSnapshot(at, cells, { reducedAccuracy });
    const byLevel = [0, 1, 2, 3, 4].map((l) => cells.filter((c) => c.level === l).length);
    slog.info({ events: events.length, cells: cells.length, byLevel, reducedAccuracy }, "snapshot saved");
    return cells;
  } catch (err) {
    slog.error(errInfo(err), "scoring failed");
    return null;
  }
}
