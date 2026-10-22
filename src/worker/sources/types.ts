import type { AuthorMeta, RawSource, SourceClass } from "@/db/schema";
import type { Env } from "@/lib/env";
import type { QuotaGuard } from "@/lib/quota";
import type { NewEvent, StoredRawItem } from "../ingest/store";

export type FetchedItem = {
  feed: string;
  externalId: string;
  text: string;
  url?: string;
  publishedAt?: Date;
  /** Coarse account signals only — never a handle or name. */
  authorMeta?: AuthorMeta;
  /** From ctx.authorKey(accountId): pseudonymous, per day. Never the account id itself. */
  authorKey?: string;
};

export type FetchResult = {
  items: FetchedItem[];
  /** Feeds that could not be read this run (skipped, not fatal). */
  failedFeeds: string[];
  /** New positions to remember (saved only after the items are stored). */
  cursors?: Record<string, string>;
};

export type AdapterContext = {
  env: Env;
  guard: QuotaGuard;
  userAgent: string;
  now: () => Date;
  /** This adapter's saved positions, filled in by the runner. */
  cursors?: Readonly<Record<string, string>>;
  /**
   * Turns a platform account id into today's pseudonymous key (filled in by the runner), so
   * different people count as independent sources (rule 3). Pass the id, store only the key.
   */
  authorKey?: (accountId: string) => string;
};

/** Poll faster after relevant items, slower after empty polls (social sources). */
export type AdaptiveSchedule = { baseMinutes: number; minMinutes: number; maxMinutes: number };

/** A pluggable source (CLAUDE.md "Sources"). Fetch through ctx.guard only. */
export interface SourceAdapter {
  id: string;
  source: RawSource;
  sourceClass: SourceClass;
  /** node-cron expression (fixed schedule). Ignored when `adaptive` is set. */
  schedule: string;
  adaptive?: AdaptiveSchedule;
  enabled(env: Env): boolean;
  fetch(ctx: AdapterContext): Promise<FetchResult>;
  /** Optional rule-based events for newly stored items (e.g. TPER diversions -> blockade). */
  signals?(items: StoredRawItem[], ctx: AdapterContext): NewEvent[];
}
