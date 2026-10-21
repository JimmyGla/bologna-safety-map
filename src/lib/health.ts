import { isStale, snapshotAgeMs } from "@/lib/freshness";

export type HealthStatus = "ok" | "degraded" | "down";

export type Health = {
  status: HealthStatus;
  time: string;
  database: "ok" | "unreachable";
  snapshot: { generatedAt: string | null; ageSeconds: number | null; stale: boolean };
  reducedAccuracy: boolean;
};

/**
 * down: database unreachable. degraded: no fresh snapshot (worker not running?) or the map
 * relies on the rules fallback. Aggregate facts only.
 */
export function computeHealth(input: { dbOk: boolean; generatedAt: Date | null; reducedAccuracy: boolean }, now: Date = new Date()): Health {
  const age = snapshotAgeMs(input.generatedAt, now);
  const stale = isStale(input.generatedAt, now);
  const status: HealthStatus = !input.dbOk ? "down" : stale || input.reducedAccuracy ? "degraded" : "ok";
  return {
    status,
    time: now.toISOString(),
    database: input.dbOk ? "ok" : "unreachable",
    snapshot: { generatedAt: input.generatedAt?.toISOString() ?? null, ageSeconds: age === null ? null : Math.round(age / 1000), stale },
    reducedAccuracy: input.reducedAccuracy,
  };
}
