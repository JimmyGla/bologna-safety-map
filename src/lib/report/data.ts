import { asc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { archivedEvents, archiveLevels } from "@/db/schema";
import { quartiereNames } from "@/lib/gazetteer/quartieri";
import { buildReport, rangeDays, type LevelDay, type Report, type ReportRange } from "./aggregate";

// Server-only. Reads the anonymous archive for /report and the CSV exports.

/** Start of the first Rome day of the range (with a day of margin for time zones). */
const sinceFor = (now: Date, days: number) => new Date(new Date(`${rangeDays(now, days)[0]}T00:00:00Z`).getTime() - 86_400_000);

export async function loadReport(range: ReportRange, now = new Date()): Promise<Report> {
  const since = sinceFor(now, range);
  const [events, levels] = await Promise.all([
    db
      .select({ period: archivedEvents.period, eventType: archivedEvents.eventType, sourceClass: archivedEvents.sourceClass, quartieri: archivedEvents.quartieri })
      .from(archivedEvents)
      .where(gte(archivedEvents.period, since)),
    db
      .select({
        day: sql<string>`to_char(${archiveLevels.hour} at time zone 'Europe/Rome', 'YYYY-MM-DD')`,
        high: sql<number>`count(*) filter (where ${archiveLevels.maxLevel} >= 3)::int`,
        red: sql<number>`count(*) filter (where ${archiveLevels.maxLevel} = 4)::int`,
      })
      .from(archiveLevels)
      .where(gte(archiveLevels.hour, since))
      .groupBy(sql`1`),
  ]);
  return buildReport(
    events.map((e) => ({ ...e, period: e.period.toISOString() })),
    levels as LevelDay[],
    now,
    range,
    quartiereNames(),
  );
}

/** Archived events for the CSV export (cells included for the precise types). */
export async function archivedEventsSince(days: number, now = new Date()) {
  return db
    .select({
      period: archivedEvents.period,
      precision: archivedEvents.precision,
      eventType: archivedEvents.eventType,
      severity: archivedEvents.severity,
      sourceClass: archivedEvents.sourceClass,
      extractor: archivedEvents.extractor,
      quartieri: archivedEvents.quartieri,
      h3Cells: archivedEvents.h3Cells,
    })
    .from(archivedEvents)
    .where(gte(archivedEvents.period, sinceFor(now, days)))
    .orderBy(asc(archivedEvents.period));
}

/** Hourly levels for the CSV export. */
export async function archivedLevelsSince(days: number, now = new Date()) {
  return db
    .select({ hour: archiveLevels.hour, h3: archiveLevels.h3, maxLevel: archiveLevels.maxLevel })
    .from(archiveLevels)
    .where(gte(archiveLevels.hour, sinceFor(now, days)))
    .orderBy(asc(archiveLevels.hour), asc(archiveLevels.h3));
}
