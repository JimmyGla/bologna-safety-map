import type { archivedEvents, EventType, Extractor, SourceClass } from "@/db/schema";
import { romeParts, romeTime } from "@/lib/dates";
import { quartieriOf } from "@/lib/gazetteer/quartieri";
import { errInfo, logger } from "@/lib/log";

const alog = logger("archive");

// Statistical archive: copies events into archived_events before the 7-day purge, keeping
// only what reports need (type, severity, source category, time, area). Attacks on people and
// sexual violence are coarsened to quartiere + Rome day: a rare event kept forever at a
// precise cell and hour could help identify a victim.

export const ARCHIVE_SCHEDULE = "*/10 * * * *";
export const COARSE_TYPES: ReadonlySet<EventType> = new Set(["assault", "hate_attack", "sexual_violence"]);
const BATCH = 500;

export type EventForArchive = {
  id: number;
  eventType: EventType;
  severity: number;
  sourceClass: SourceClass;
  extractor: Extractor;
  occurredAt: Date;
  h3Cells: string[];
};
export type NewArchivedEvent = Omit<typeof archivedEvents.$inferInsert, "id" | "archivedAt">;

const hourStart = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
const romeDayStart = (d: Date) => {
  const p = romeParts(d);
  return romeTime(p.y, p.m, p.d);
};

export function toArchived(e: EventForArchive): NewArchivedEvent {
  const coarse = COARSE_TYPES.has(e.eventType);
  return {
    sourceEventId: e.id,
    period: coarse ? romeDayStart(e.occurredAt) : hourStart(e.occurredAt),
    precision: coarse ? "day" : "hour",
    eventType: e.eventType,
    severity: e.severity,
    sourceClass: e.sourceClass,
    extractor: e.extractor,
    quartieri: quartieriOf(e.h3Cells),
    h3Cells: coarse ? [] : [...e.h3Cells].sort(),
  };
}

export interface ArchiveStore {
  /** Events not archived yet, oldest first. */
  unarchivedEvents(limit: number): Promise<EventForArchive[]>;
  /** Inserts, skipping ones already archived; returns how many were added. */
  insertArchived(rows: NewArchivedEvent[]): Promise<number>;
}

/** Copies everything not yet archived (in batches). Never throws. */
export async function runArchive(store: ArchiveStore): Promise<number> {
  let total = 0;
  try {
    for (;;) {
      const batch = await store.unarchivedEvents(BATCH);
      if (!batch.length) break;
      total += await store.insertArchived(batch.map(toArchived));
      if (batch.length < BATCH) break;
    }
    if (total) alog.info({ archived: total }, "events archived");
  } catch (err) {
    alog.error(errInfo(err), "archiving failed");
  }
  return total;
}

/** For dry runs and tests. */
export class MemoryArchiveStore implements ArchiveStore {
  archived: NewArchivedEvent[] = [];
  constructor(private events: () => EventForArchive[] = () => []) {}
  async unarchivedEvents(limit: number) {
    const done = new Set(this.archived.map((a) => a.sourceEventId));
    return this.events()
      .filter((e) => !done.has(e.id))
      .sort((a, b) => a.id - b.id)
      .slice(0, limit);
  }
  async insertArchived(rows: NewArchivedEvent[]) {
    const done = new Set(this.archived.map((a) => a.sourceEventId));
    const fresh = rows.filter((r) => !done.has(r.sourceEventId));
    this.archived.push(...fresh);
    return fresh.length;
  }
}
