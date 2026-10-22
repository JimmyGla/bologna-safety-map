import type { AuthorMeta, events, plannedEvents, RawSource, sourceStatus } from "@/db/schema";
import { newSalt } from "./author-key";

export type NewRawItem = {
  source: RawSource;
  feed: string;
  externalId: string;
  text: string;
  url?: string;
  publishedAt?: Date;
  authorMeta?: AuthorMeta;
  /** Pseudonymous per-day author key (author-key.ts). Never a handle or account id. */
  authorKey?: string;
};
export type StoredRawItem = NewRawItem & { id: number };
export type PendingRawItem = StoredRawItem & { fetchedAt: Date };
export type NewEvent = Omit<typeof events.$inferInsert, "id" | "createdAt">;
export type NewPlannedEvent = Omit<typeof plannedEvents.$inferInsert, "id" | "createdAt">;
export type SourceStatusRow = typeof sourceStatus.$inferInsert;

/** Persistence used by ingestion. DbIngestStore in production, MemoryIngestStore in tests/dry runs. */
export interface IngestStore {
  existingExternalIds(source: RawSource, ids: string[]): Promise<Set<string>>;
  recentTexts(since: Date): Promise<string[]>;
  /** Inserts, skipping (source, external_id) conflicts; returns the rows actually inserted. */
  insertRawItems(items: NewRawItem[]): Promise<StoredRawItem[]>;
  insertEvents(events: NewEvent[]): Promise<void>;
  insertPlanned(rows: NewPlannedEvent[]): Promise<void>;
  markProcessed(ids: number[]): Promise<void>;
  saveStatus(status: SourceStatusRow): Promise<void>;
  /** Oldest unprocessed raw items first. */
  unprocessed(limit: number): Promise<PendingRawItem[]>;
  getCursors(adapter: string): Promise<Record<string, string>>;
  saveCursors(adapter: string, cursors: Record<string, string>): Promise<void>;
  /** The random salt for author keys of this UTC day (created on first use). */
  authorSalt(day: string): Promise<string>;
}

export class MemoryIngestStore implements IngestStore {
  raw: (StoredRawItem & { fetchedAt: Date; processed: boolean })[] = [];
  events: NewEvent[] = [];
  planned: NewPlannedEvent[] = [];
  status = new Map<string, SourceStatusRow>();
  cursors = new Map<string, Record<string, string>>();
  salts = new Map<string, string>();
  private nextId = 1;

  constructor(private now: () => Date = () => new Date()) {}

  async existingExternalIds(source: RawSource, ids: string[]) {
    const wanted = new Set(ids);
    return new Set(this.raw.filter((r) => r.source === source && wanted.has(r.externalId)).map((r) => r.externalId));
  }

  async recentTexts(since: Date) {
    return this.raw.filter((r) => r.fetchedAt >= since).map((r) => r.text);
  }

  async insertRawItems(items: NewRawItem[]) {
    const out: StoredRawItem[] = [];
    for (const item of items) {
      if (this.raw.some((r) => r.source === item.source && r.externalId === item.externalId)) continue;
      const row = { ...item, id: this.nextId++ };
      this.raw.push({ ...row, fetchedAt: this.now(), processed: false });
      out.push(row);
    }
    return out;
  }

  async insertEvents(events: NewEvent[]) {
    this.events.push(...events);
  }

  async insertPlanned(rows: NewPlannedEvent[]) {
    this.planned.push(...rows);
  }

  async markProcessed(ids: number[]) {
    for (const r of this.raw) if (ids.includes(r.id)) r.processed = true;
  }

  async saveStatus(status: SourceStatusRow) {
    this.status.set(status.adapter, status);
  }

  async getCursors(adapter: string) {
    return { ...this.cursors.get(adapter) };
  }

  async saveCursors(adapter: string, cursors: Record<string, string>) {
    this.cursors.set(adapter, { ...this.cursors.get(adapter), ...cursors });
  }

  async authorSalt(day: string) {
    if (!this.salts.has(day)) this.salts.set(day, newSalt());
    return this.salts.get(day)!;
  }

  async unprocessed(limit: number) {
    return this.raw
      .filter((r) => !r.processed)
      .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())
      .slice(0, limit)
      .map((r) => {
        const { processed, ...rest } = r;
        void processed;
        return rest;
      });
  }
}
