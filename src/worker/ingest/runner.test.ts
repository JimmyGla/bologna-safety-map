import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { QuotaGuard } from "@/lib/quota";
import type { AdapterContext, FetchedItem, SourceAdapter } from "../sources/types";
import { runAdapter } from "./runner";
import { MemoryIngestStore } from "./store";

const NOW = new Date("2026-10-21T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const ctx: AdapterContext = {
  env: parseEnv({ DATABASE_URL: "postgres://u:p@localhost/db" }),
  guard: new QuotaGuard({ warn: () => {} }),
  userAgent: "test",
  now: () => NOW,
};

function adapter(items: FetchedItem[] | Error, extra: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    id: "test",
    source: "news",
    sourceClass: "news",
    schedule: "* * * * *",
    enabled: () => true,
    fetch: async () => {
      if (items instanceof Error) throw items;
      return { items, failedFeeds: [] };
    },
    ...extra,
  };
}

const item = (id: string, text: string, publishedAt = ago(1)): FetchedItem => ({ feed: "f", externalId: id, text, publishedAt });

describe("runAdapter", () => {
  it("stores social posts up to 24h old, skipping older ones", async () => {
    const store = new MemoryIngestStore(() => NOW);
    const social = adapter([item("a", "Corteo in via Zamboni"), item("old", "Presidio ieri", ago(30))], { source: "reddit", sourceClass: "social" });
    const s = await runAdapter(social, ctx, store);
    expect(s).toMatchObject({ status: "ok", fetched: 2, inserted: 1, stale: 1 });
    expect(store.raw.map((r) => r.externalId)).toEqual(["a"]);
    expect(store.status.get("test")).toMatchObject({ status: "ok", inserted: 1, lastError: null });
  });

  it("keeps news up to 7 days old as forecast history, skipping older", async () => {
    const store = new MemoryIngestStore(() => NOW);
    const s = await runAdapter(
      adapter([item("a", "Corteo in via Zamboni"), item("week", "Scontri in stazione, lacrimogeni", ago(5 * 24)), item("old", "Presidio al Pilastro", ago(8 * 24))]),
      ctx,
      store,
    );
    expect(s).toMatchObject({ fetched: 3, inserted: 2, stale: 1 });
    expect(store.raw.map((r) => r.externalId)).toEqual(["a", "week"]);
  });

  it("dedupes by external id across runs and by near-identical text", async () => {
    const store = new MemoryIngestStore(() => NOW);
    await runAdapter(adapter([item("a", "Corteo degli studenti in piazza Verdi verso via Zamboni")]), ctx, store);
    const s = await runAdapter(
      adapter([
        item("a", "Corteo degli studenti in piazza Verdi verso via Zamboni"),
        item("b", "Corteo degli studenti in piazza Verdi verso via Zamboni!"),
        item("c", "Presidio al Pilastro"),
        item("c", "Presidio al Pilastro"),
      ]),
      ctx,
      store,
    );
    expect(s).toMatchObject({ inserted: 1, duplicates: 3 });
    expect(store.raw.map((r) => r.externalId)).toEqual(["a", "c"]);
  });

  it("scrubs handles before storing", async () => {
    const store = new MemoryIngestStore(() => NOW);
    await runAdapter(adapter([item("a", "Polizia in via Irnerio, foto di u/someone_here")]), ctx, store);
    expect(store.raw[0].text).toBe("Polizia in via Irnerio, foto di");
  });

  it("swallows adapter errors and records them", async () => {
    const store = new MemoryIngestStore(() => NOW);
    const s = await runAdapter(adapter(new TypeError("boom")), ctx, store);
    expect(s.status).toBe("error");
    expect(store.status.get("test")).toMatchObject({ status: "error", lastError: "TypeError: boom" });
  });

  it("marks the run as an error only when every feed failed", async () => {
    const store = new MemoryIngestStore(() => NOW);
    const partial = adapter([], { fetch: async () => ({ items: [item("a", "Corteo")], failedFeeds: ["x"] }) });
    expect((await runAdapter(partial, ctx, store)).status).toBe("ok");
    const none = adapter([], { fetch: async () => ({ items: [], failedFeeds: ["x", "y"] }) });
    expect(await runAdapter(none, ctx, store)).toMatchObject({ status: "error", lastError: "feeds unavailable: x, y" });
  });

  it("does nothing for a disabled adapter but records it", async () => {
    const store = new MemoryIngestStore(() => NOW);
    let fetched = false;
    const s = await runAdapter(adapter([], { enabled: () => false, fetch: async () => ((fetched = true), { items: [], failedFeeds: [] }) }), ctx, store);
    expect(s.status).toBe("disabled");
    expect(fetched).toBe(false);
  });

  it("stores signals as events and marks their items processed", async () => {
    const store = new MemoryIngestStore(() => NOW);
    const withSignals = adapter([item("a", "Corteo in via Rizzoli")], {
      signals: (items) =>
        items.map((i) => ({
          rawItemId: i.id, source: "news", sourceFeed: "f", eventType: "march", severity: 1, confidence: 0.5,
          credibility: 0.5, occurredAt: NOW, sourceClass: "news", extractor: "rules",
        })),
    });
    const s = await runAdapter(withSignals, ctx, store);
    expect(s.events).toBe(1);
    expect(store.raw[0].processed).toBe(true);
  });
});
