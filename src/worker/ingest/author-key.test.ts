import { describe, expect, it } from "vitest";
import { groupUpcoming, type PlannedRow } from "@/lib/planned";
import type { SourceAdapter } from "../sources/types";
import { QuotaGuard } from "@/lib/quota";
import { parseEnv } from "@/lib/env";
import { authorKey, newSalt, saltDay } from "./author-key";
import { runAdapter } from "./runner";
import { MemoryIngestStore } from "./store";

const NOW = new Date("2026-10-22T09:00:00Z");

describe("authorKey", () => {
  const salt = newSalt();

  it("is stable within a day and different per account and per platform", () => {
    expect(authorKey(salt, "bluesky", "did:plc:alice")).toBe(authorKey(salt, "bluesky", "did:plc:alice"));
    expect(authorKey(salt, "bluesky", "did:plc:alice")).not.toBe(authorKey(salt, "bluesky", "did:plc:bob"));
    expect(authorKey(salt, "bluesky", "x")).not.toBe(authorKey(salt, "reddit", "x"));
  });

  it("changes with the daily salt and doesn't contain the account id", () => {
    const k = authorKey(salt, "bluesky", "did:plc:alice");
    expect(authorKey(newSalt(), "bluesky", "did:plc:alice")).not.toBe(k);
    expect(k).toMatch(/^a:[0-9a-f]{24}$/);
    expect(k).not.toContain("alice");
  });
});

describe("runner and author keys", () => {
  // An adapter that reports the same two accounts every run. Texts differ enough to pass the
  // runner's near-duplicate filter.
  const TEXTS = ["Corteo in via Zamboni verso piazza Verdi", "Presidio davanti alla stazione centrale", "Scontri in Bolognina, lanciati lacrimogeni"];
  const adapter: SourceAdapter = {
    id: "fake",
    source: "bluesky",
    sourceClass: "social",
    schedule: "* * * * *",
    enabled: () => true,
    async fetch(ctx) {
      return {
        failedFeeds: [],
        items: ["did:plc:alice", "did:plc:alice", "did:plc:bob"].map((did, i) => ({
          feed: "search",
          externalId: `${ctx.now().getTime()}-${i}`,
          text: `${TEXTS[i]} (${ctx.now().toISOString()})`,
          publishedAt: ctx.now(),
          authorKey: ctx.authorKey?.(did),
        })),
      };
    },
  };
  const ctx = (now: Date) => ({
    env: parseEnv({ DATABASE_URL: "postgres://u:p@localhost/db" }),
    guard: new QuotaGuard({ warn: () => {} }),
    userAgent: "test",
    now: () => now,
  });

  it("stores only keys, the same key for the same account within the day", async () => {
    const store = new MemoryIngestStore(() => NOW);
    await runAdapter(adapter, ctx(NOW), store);
    const keys = store.raw.map((r) => r.authorKey);
    expect(keys[0]).toMatch(/^a:/);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(JSON.stringify(store.raw)).not.toContain("did:plc");

    const later = new Date(NOW.getTime() + 3_600_000); // same UTC day, new run
    await runAdapter(adapter, ctx(later), store);
    expect(store.raw[3].authorKey).toBe(keys[0]);
    expect(store.salts.has(saltDay(NOW))).toBe(true);
  });

  it("uses a new salt (unlinkable keys) the next day", async () => {
    const store = new MemoryIngestStore(() => NOW);
    await runAdapter(adapter, ctx(NOW), store);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    await runAdapter(adapter, ctx(tomorrow), store);
    expect(store.raw[3].authorKey).not.toBe(store.raw[0].authorKey);
  });
});

describe("announcements count people too", () => {
  const row = (authorKey: string): PlannedRow => ({
    eventType: "march",
    startsAt: new Date("2026-10-24T13:00:00Z"),
    timeKnown: true,
    locationNames: ["Piazza Verdi"],
    h3Cells: ["891ea0582d3ffff"],
    sourceFeed: "bluesky:search",
    sourceClass: "social",
    authorKey,
  });

  it("shows an announcement reported by two different people on one platform", () => {
    expect(groupUpcoming([row("a:1"), row("a:2")], NOW)).toHaveLength(1);
    expect(groupUpcoming([row("a:1"), row("a:1")], NOW)).toHaveLength(0);
  });
});
