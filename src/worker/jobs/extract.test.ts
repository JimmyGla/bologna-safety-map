import { describe, expect, it } from "vitest";
import { geocodePlace } from "@/lib/gazetteer";
import { MemoryGeocodeCache } from "@/lib/gazetteer/nominatim";
import { createRulesProvider, type LlmProvider } from "@/lib/llm";
import { credibility } from "@/lib/scoring/credibility";
import { QuotaGuard } from "@/lib/quota";
import { MemoryIngestStore, type NewRawItem } from "../ingest/store";
import { runExtraction } from "./extract";

const NOW = new Date("2026-10-21T12:00:00Z");

async function seed(items: Partial<NewRawItem>[]) {
  const store = new MemoryIngestStore(() => NOW);
  await store.insertRawItems(
    items.map((i, n) => ({ source: "news", feed: "carlino", externalId: `e${n}`, text: "", publishedAt: new Date(NOW.getTime() - 600_000), ...i })),
  );
  return store;
}

// Nominatim must never be reached in these tests: a fetch would throw.
const offlineGuard = new QuotaGuard({ warn: () => {}, fetchImpl: (async () => { throw new Error("network in test"); }) as unknown as typeof fetch });
const geocode = (phrase: string) => geocodePlace(phrase, { cache: new MemoryGeocodeCache(), userAgent: "test", guard: offlineGuard });
const rules = createRulesProvider(() => NOW);

describe("runExtraction", () => {
  it("turns relevant items into located events and drops the rest", async () => {
    const store = await seed([
      { text: "Scontri in piazza Verdi, lanciati lacrimogeni" },
      { text: "Video di 5 anni fa: scontri in piazza Verdi" },
      { text: "Ieri sera presidio in piazza dell'Unità" },
      { text: "Corteo in corso, ma nessun luogo indicato" },
    ]);
    const s = await runExtraction({ store, provider: rules, rules, geocode, now: () => NOW });

    expect(s).toMatchObject({ items: 4, events: 1, dropped: 2, unlocated: 1 });
    const [ev] = store.events;
    expect(ev).toMatchObject({
      eventType: "clashes",
      severity: 3,
      source: "news",
      sourceFeed: "news:carlino",
      sourceClass: "news",
      extractor: "rules",
      credibility: 0.85,
      locationNames: ["Piazza Verdi"],
    });
    expect(ev.h3Cells!.length).toBeGreaterThan(0);
    // rules confidence (≤0.5) × 0.8
    expect(ev.confidence).toBeLessThanOrEqual(0.4);
    expect(await store.unprocessed(10)).toEqual([]);
    expect(store.status.get("extract")).toMatchObject({ status: "ok", fetched: 4, inserted: 1 });
  });

  it("uses the LLM's locations and confidence, and social credibility", async () => {
    const store = await seed([{ source: "reddit", feed: "r/bologna", text: "sono qui, la polizia ha caricato", authorMeta: { account_age_days: 800, follower_count: 50 } }]);
    const llm: LlmProvider = {
      name: "gemini",
      maxBatch: 20,
      extract: async (items) =>
        new Map(items.map((i) => [i.id, { relevant: true, event_type: "clashes", severity: 3, locations: ["via Zamboni"], is_firsthand: true, time_reference: "now", confidence: 0.9 }])),
    };
    await runExtraction({ store, provider: llm, rules, geocode, now: () => NOW });
    expect(store.events[0]).toMatchObject({
      extractor: "gemini",
      confidence: 0.9,
      sourceClass: "social",
      credibility: credibility("social", { account_age_days: 800 }, true),
      locationNames: ["Via Zamboni"],
    });
  });

  it("strips handles from extractor locations", async () => {
    const store = await seed([{ text: "corteo" }]);
    const llm: LlmProvider = {
      name: "gemini",
      maxBatch: 20,
      extract: async (items) =>
        new Map(items.map((i) => [i.id, { relevant: true, event_type: "march", severity: 1, locations: ["@someone", "piazza Maggiore"], is_firsthand: false, time_reference: "now", confidence: 0.8 }])),
    };
    await runExtraction({ store, provider: llm, rules, geocode, now: () => NOW });
    expect(store.events[0].locationNames).toEqual(["Piazza Maggiore"]);
  });

  it("records errors instead of throwing", async () => {
    const store = await seed([{ text: "corteo in via Zamboni" }]);
    store.unprocessed = async () => {
      throw new Error("db down");
    };
    const s = await runExtraction({ store, provider: rules, rules, geocode, now: () => NOW });
    expect(s.events).toBe(0);
    expect(store.status.get("extract")).toMatchObject({ status: "error", lastError: "Error: db down" });
  });
});

describe("credibility", () => {
  it("follows the source table", () => {
    expect(credibility("official")).toBe(1);
    expect(credibility("news")).toBe(0.85);
    expect(credibility("transit")).toBe(0.8);
    expect(credibility("social")).toBe(0.3);
    expect(credibility("social", { account_age_days: 400 })).toBe(0.4);
    expect(credibility("social", { account_age_days: 400, follower_count: 5_000 }, true)).toBe(0.6);
  });

  it("caps social at 0.7", () => {
    expect(credibility("social", { account_age_days: 9_999, follower_count: 1e6 }, true)).toBeLessThanOrEqual(0.7);
  });
});
