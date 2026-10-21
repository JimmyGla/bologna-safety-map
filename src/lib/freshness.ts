// Shared by the map (stale banner) and /api/health. Client-safe.

/** The worker snapshots every minute; past this the map is considered out of date. */
export const STALE_AFTER_MS = 10 * 60_000;

export function snapshotAgeMs(generatedAt: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!generatedAt) return null;
  const t = new Date(generatedAt).getTime();
  return Number.isNaN(t) ? null : Math.max(0, now.getTime() - t);
}

/** No snapshot yet, or none in the last 10 minutes. */
export function isStale(generatedAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  const age = snapshotAgeMs(generatedAt, now);
  return age === null || age > STALE_AFTER_MS;
}
