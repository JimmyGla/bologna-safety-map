import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, plannedEvents, rawItems, sourceCursors, sourceStatus, type RawSource } from "@/db/schema";
import { AUTHOR_SALT_ADAPTER, newSalt } from "./author-key";
import type { IngestStore, NewEvent, NewPlannedEvent, NewRawItem, PendingRawItem, SourceStatusRow, StoredRawItem } from "./store";

export class DbIngestStore implements IngestStore {
  async existingExternalIds(source: RawSource, ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await db
      .select({ externalId: rawItems.externalId })
      .from(rawItems)
      .where(and(eq(rawItems.source, source), inArray(rawItems.externalId, ids)));
    return new Set(rows.map((r) => r.externalId));
  }

  async recentTexts(since: Date) {
    const rows = await db.select({ text: rawItems.text }).from(rawItems).where(gte(rawItems.fetchedAt, since));
    return rows.map((r) => r.text);
  }

  async insertRawItems(items: NewRawItem[]): Promise<StoredRawItem[]> {
    if (!items.length) return [];
    const rows = await db
      .insert(rawItems)
      .values(items)
      .onConflictDoNothing({ target: [rawItems.source, rawItems.externalId] })
      .returning({ id: rawItems.id, externalId: rawItems.externalId });
    const byId = new Map(rows.map((r) => [r.externalId, r.id]));
    return items.filter((i) => byId.has(i.externalId)).map((i) => ({ ...i, id: byId.get(i.externalId)! }));
  }

  async insertEvents(rows: NewEvent[]) {
    if (rows.length) await db.insert(events).values(rows);
  }

  async insertPlanned(rows: NewPlannedEvent[]) {
    if (rows.length) await db.insert(plannedEvents).values(rows);
  }

  async markProcessed(ids: number[]) {
    if (ids.length) await db.update(rawItems).set({ processed: true }).where(inArray(rawItems.id, ids));
  }

  async unprocessed(limit: number): Promise<PendingRawItem[]> {
    const rows = await db
      .select()
      .from(rawItems)
      .where(eq(rawItems.processed, false))
      .orderBy(asc(rawItems.fetchedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      feed: r.feed,
      externalId: r.externalId,
      text: r.text,
      url: r.url ?? undefined,
      publishedAt: r.publishedAt ?? undefined,
      authorMeta: r.authorMeta ?? undefined,
      authorKey: r.authorKey ?? undefined,
      fetchedAt: r.fetchedAt,
    }));
  }

  async getCursors(adapter: string) {
    const rows = await db.select().from(sourceCursors).where(eq(sourceCursors.adapter, adapter));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async authorSalt(day: string) {
    // First caller of the day creates it; concurrent workers keep whichever landed first.
    await db.insert(sourceCursors).values({ adapter: AUTHOR_SALT_ADAPTER, key: day, value: newSalt(), updatedAt: new Date() }).onConflictDoNothing();
    const [row] = await db
      .select({ value: sourceCursors.value })
      .from(sourceCursors)
      .where(and(eq(sourceCursors.adapter, AUTHOR_SALT_ADAPTER), eq(sourceCursors.key, day)))
      .limit(1);
    return row.value;
  }

  async saveCursors(adapter: string, cursors: Record<string, string>) {
    const rows = Object.entries(cursors).map(([key, value]) => ({ adapter, key, value, updatedAt: new Date() }));
    if (!rows.length) return;
    await db
      .insert(sourceCursors)
      .values(rows)
      .onConflictDoUpdate({
        target: [sourceCursors.adapter, sourceCursors.key],
        set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
      });
  }

  async saveStatus(status: SourceStatusRow) {
    await db.insert(sourceStatus).values(status).onConflictDoUpdate({ target: sourceStatus.adapter, set: { ...status, adapter: undefined } });
  }
}
