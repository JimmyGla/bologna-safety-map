import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { archivedEvents, events } from "@/db/schema";
import type { ArchiveStore, NewArchivedEvent } from "./archive";

export class DbArchiveStore implements ArchiveStore {
  async unarchivedEvents(limit: number) {
    return db
      .select({
        id: events.id,
        eventType: events.eventType,
        severity: events.severity,
        sourceClass: events.sourceClass,
        extractor: events.extractor,
        occurredAt: events.occurredAt,
        h3Cells: events.h3Cells,
      })
      .from(events)
      .where(sql`not exists (select 1 from ${archivedEvents} a where a.source_event_id = ${events.id})`)
      .orderBy(asc(events.id))
      .limit(limit);
  }

  async insertArchived(rows: NewArchivedEvent[]) {
    if (!rows.length) return 0;
    const inserted = await db
      .insert(archivedEvents)
      .values(rows)
      .onConflictDoNothing({ target: archivedEvents.sourceEventId })
      .returning({ id: archivedEvents.id });
    return inserted.length;
  }
}
