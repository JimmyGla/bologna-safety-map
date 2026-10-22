import type { AdapterContext, SourceAdapter } from "../sources/types";
import { authorKey, saltDay } from "./author-key";
import { NEAR_DUPLICATE_WINDOW_MS, NearDuplicateIndex } from "./dedupe";
import type { IngestStore, NewRawItem, SourceStatusRow } from "./store";
import { clip, scrubHandles } from "./text";
import { errInfo, errSummary, logger } from "@/lib/log";

const MAX_AGE_MS = 24 * 3_600_000; // older items would be purged right away (rule 1)

export type RunSummary = {
  adapter: string;
  status: SourceStatusRow["status"];
  fetched: number;
  inserted: number;
  duplicates: number;
  events: number;
  /** Older than 24h, dropped. */
  stale: number;
  lastError: string | null;
};

const slog = logger("source");

/**
 * Runs one adapter end to end. Never throws: errors are logged (class + message, never
 * item text) and recorded in source_status.
 */
export async function runAdapter(adapter: SourceAdapter, ctx: AdapterContext, store: IngestStore): Promise<RunSummary> {
  const started = ctx.now();
  const summary: RunSummary = { adapter: adapter.id, status: "ok", fetched: 0, inserted: 0, duplicates: 0, lastError: null, events: 0, stale: 0 };

  if (!adapter.enabled(ctx.env)) {
    summary.status = "disabled";
  } else {
    try {
      const cursors = await store.getCursors(adapter.id);
      // Today's salt for pseudonymous author keys. Without it, posts simply carry no key
      // (each platform then counts as one source, as before).
      let keyer: AdapterContext["authorKey"];
      try {
        const salt = await store.authorSalt(saltDay(started));
        keyer = (accountId) => authorKey(salt, adapter.source, accountId);
      } catch (err) {
        slog.warn({ adapter: adapter.id, ...errInfo(err) }, "no author salt; posts get no author key");
      }
      const { items, failedFeeds, cursors: next } = await adapter.fetch({ ...ctx, cursors, authorKey: keyer });
      summary.fetched = items.length;
      if (failedFeeds.length) {
        summary.lastError = `feeds unavailable: ${failedFeeds.join(", ")}`;
        if (!items.length) summary.status = "error";
      }

      const fresh = items
        .filter((i) => !i.publishedAt || started.getTime() - i.publishedAt.getTime() <= MAX_AGE_MS)
        .map((i) => ({ ...i, text: clip(scrubHandles(i.text)) }))
        .filter((i) => i.text.length > 0);
      summary.stale = items.length - fresh.length;

      const known = await store.existingExternalIds(adapter.source, fresh.map((i) => i.externalId));
      const near = new NearDuplicateIndex(await store.recentTexts(new Date(started.getTime() - NEAR_DUPLICATE_WINDOW_MS)));
      const seen = new Set<string>();
      const accepted: NewRawItem[] = [];
      for (const i of fresh) {
        if (known.has(i.externalId) || seen.has(i.externalId) || near.checkAndAdd(i.text)) {
          summary.duplicates++;
          continue;
        }
        seen.add(i.externalId);
        accepted.push({ source: adapter.source, ...i });
      }

      const stored = await store.insertRawItems(accepted);
      summary.inserted = stored.length;
      summary.duplicates += accepted.length - stored.length;
      // Only advance once the items are safely stored, so a failed insert is retried.
      if (next && Object.keys(next).length) await store.saveCursors(adapter.id, next);

      if (adapter.signals && stored.length) {
        const evs = adapter.signals(stored, ctx);
        if (evs.length) {
          await store.insertEvents(evs);
          await store.markProcessed(stored.map((s) => s.id));
        }
        summary.events = evs.length;
      }
    } catch (err) {
      const e = err as Error;
      summary.status = "error";
      summary.lastError = errSummary(e);
      slog.error({ adapter: adapter.id, ...errInfo(err) }, "run failed");
    }
  }

  const finished = ctx.now();
  try {
    await store.saveStatus({
      adapter: adapter.id,
      status: summary.status,
      lastRunAt: finished,
      ...(summary.status === "ok" ? { lastSuccessAt: finished } : {}),
      fetched: summary.fetched,
      inserted: summary.inserted,
      duplicates: summary.duplicates,
      durationMs: finished.getTime() - started.getTime(),
      lastError: summary.lastError,
    });
  } catch (err) {
    slog.error({ adapter: adapter.id, ...errInfo(err) }, "could not save status");
  }

  if (summary.status !== "disabled") {
    const { adapter: id, ...counts } = summary;
    slog[summary.status === "error" ? "warn" : "info"]({ adapter: id, ...counts }, "run finished");
  }
  return summary;
}
