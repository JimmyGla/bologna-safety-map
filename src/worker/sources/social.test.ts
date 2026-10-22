import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";
import { QuotaGuard } from "@/lib/quota";
import { AdaptivePoller } from "../ingest/adaptive";
import { runAdapter } from "../ingest/runner";
import { MemoryIngestStore } from "../ingest/store";
import { blueskyQueries, createBlueskyAdapter, rotate, type BskyClient, type BskyPost } from "./bluesky";
import { seal, unseal } from "./sealed";
import { mastodonAdapter } from "./mastodon";
import { createTelegramAdapter, type TgClient } from "./telegram";
import type { AdapterContext } from "./types";

const NOW = new Date("2026-10-21T12:00:00Z");
const BASE = { DATABASE_URL: "postgres://u:p@localhost/db" };

function ctxWith(env: Record<string, string>, fetchImpl?: typeof fetch, cursors?: Record<string, string>): AdapterContext {
  return {
    env: parseEnv({ ...BASE, ...env }),
    guard: new QuotaGuard({ warn: () => {}, sleep: async () => {}, now: () => NOW.getTime(), fetchImpl }),
    userAgent: "test-agent",
    now: () => NOW,
    cursors,
  };
}

// Nothing identifying may survive into a stored item.
const IDENTIFIERS = /did:plc|alice|mario\.rossi|@|bsky\.app|\/users\/|\/@/;

describe("bluesky", () => {
  const post = (n: number, text: string, did = "did:plc:alice123"): BskyPost => ({
    uri: `at://${did}/app.bsky.feed.post/${n}`,
    author: { did },
    record: { text, createdAt: `2026-10-21T11:${String(10 + n).padStart(2, "0")}:00Z` },
    indexedAt: `2026-10-21T11:${String(10 + n).padStart(2, "0")}:05Z`,
  });

  function fake(posts: BskyPost[]) {
    const searchPosts = vi.fn<BskyClient["searchPosts"]>(async () => ({ posts }));
    const getProfiles = vi.fn<BskyClient["getProfiles"]>(async (actors) =>
      actors.map((did) => ({ did, followersCount: 1500, createdAt: "2024-10-21T00:00:00Z" })),
    );
    return { client: { searchPosts, getProfiles }, searchPosts, getProfiles };
  }

  const env = {
    SOURCE_BLUESKY_ENABLED: "true",
    BSKY_HANDLE: "me.bsky.social",
    BSKY_APP_PASSWORD: "xxxx-xxxx",
    BLUESKY_KEYWORDS: "corteo,scontri",
    BLUESKY_PLACES: "bologna,zona universitaria",
    BLUESKY_VIOLENCE_KEYWORDS: "pestaggio,violenza sessuale",
  };
  const QUERIES = [
    "corteo bologna", 'corteo "zona universitaria"', "scontri bologna", 'scontri "zona universitaria"',
    "pestaggio bologna", '"violenza sessuale" bologna',
  ];

  it("builds keyword × place queries, plus violence keywords with the city", () => {
    expect(blueskyQueries(parseEnv({ ...BASE, ...env }))).toEqual(QUERIES);
  });

  it("searches the violence keywords by default", () => {
    const q = blueskyQueries(parseEnv({ ...BASE, SOURCE_BLUESKY_ENABLED: "true" }));
    expect(q).toEqual(expect.arrayContaining(["aggressione bologna", "pestaggio bologna", '"violenza sessuale" bologna', "squadristi bologna"]));
    expect(q).toHaveLength(22); // 4 protest × 3 places + 10 violence × the city
  });

  it("searches in Italian, newest first, from the saved cursor, and keeps only allowed fields", async () => {
    const { client, searchPosts, getProfiles } = fake([
      post(1, "Corteo in via Zamboni, ci sono anche io @mario.rossi"),
      post(2, "Che bella giornata a Bologna"),
    ]);
    const adapter = createBlueskyAdapter(async () => client);
    const res = await adapter.fetch(ctxWith(env, undefined, { since: "2026-10-21T11:00:00Z" }));

    expect(searchPosts).toHaveBeenCalledTimes(6);
    // The old single cursor, minus 5 minutes of overlap for late-indexed posts.
    expect(searchPosts.mock.calls[0][0]).toEqual({ q: "corteo bologna", lang: "it", sort: "latest", since: "2026-10-21T10:55:00.000Z", limit: 50 });
    expect(getProfiles).toHaveBeenCalledWith(["did:plc:alice123"]);
    expect(res.items).toHaveLength(1); // the off-topic post is filtered out
    const [item] = res.items;
    expect(item.authorMeta).toEqual({ follower_count: 1500, account_age_days: 730 });
    expect(item.url).toBeUndefined();
    expect(item.externalId).toMatch(/^bsky:[0-9a-f]{32}$/);
    expect(JSON.stringify({ ...item, text: "" })).not.toMatch(IDENTIFIERS);
    // Every search remembers when it ran; the rotation wrapped around to the start.
    expect(res.cursors).toEqual({ next: "0", ...Object.fromEntries(QUERIES.map((q) => [`since:${q}`, NOW.toISOString()])) });
  });

  it("rotates searches across runs, BLUESKY_QUERIES_PER_RUN at a time", async () => {
    const { client, searchPosts } = fake([]);
    const adapter = createBlueskyAdapter(async () => client);
    const perRun = { ...env, BLUESKY_QUERIES_PER_RUN: "4" };
    const first = await adapter.fetch(ctxWith(perRun));
    const second = await adapter.fetch(ctxWith(perRun, undefined, first.cursors));
    expect(searchPosts.mock.calls.map((c) => c[0].q)).toEqual([...QUERIES, ...QUERIES.slice(0, 2)]);
    expect(first.cursors?.next).toBe("4");
    expect(second.cursors?.next).toBe("2");
  });

  it("continues each search from its own last run, and keeps a failed search's position", async () => {
    const { client, searchPosts } = fake([]);
    searchPosts.mockImplementation(async ({ q }) => {
      if (q === "scontri bologna") throw new Error("boom");
      return { posts: [] };
    });
    const cursors = { "since:corteo bologna": "2026-10-21T11:50:00.000Z", "since:scontri bologna": "2026-10-21T11:40:00.000Z" };
    const res = await createBlueskyAdapter(async () => client).fetch(ctxWith(env, undefined, cursors));
    const since = Object.fromEntries(searchPosts.mock.calls.map((c) => [c[0].q, c[0].since]));
    expect(since["corteo bologna"]).toBe("2026-10-21T11:45:00.000Z");
    expect(since['corteo "zona universitaria"']).toBe("2026-10-21T10:00:00.000Z"); // never ran: 2h back
    expect(res.failedFeeds).toEqual(['search "scontri bologna"']);
    expect(res.cursors?.["since:scontri bologna"]).toBeUndefined(); // not advanced: the gap is re-read next time
  });

  it("hands the saved session to the connection and saves the current one", async () => {
    const { client } = fake([]);
    const connect = vi.fn(async (_env: unknown, saved: string | undefined) => ({ client, sealedSession: () => `${saved ?? "new"}+` }));
    const res = await createBlueskyAdapter(connect).fetch(ctxWith(env, undefined, { session: "v1.saved" }));
    expect(connect.mock.calls[0][1]).toBe("v1.saved");
    expect(res.cursors?.session).toBe("v1.saved+");
  });

  it("keys posts by author through ctx.authorKey, without keeping the DID", async () => {
    const { client } = fake([post(1, "Corteo in via Zamboni", "did:plc:alice123"), post(2, "Corteo in piazza Verdi", "did:plc:bob456")]);
    const ctx = { ...ctxWith(env), authorKey: (id: string) => `a:${id.length}-${id.endsWith("123") ? "x" : "y"}` };
    const res = await createBlueskyAdapter(async () => client).fetch(ctx);
    expect(res.items.map((i) => i.authorKey)).toEqual([ctx.authorKey("did:plc:alice123"), ctx.authorKey("did:plc:bob456")]);
    for (const item of res.items) expect(JSON.stringify({ ...item, text: "" })).not.toMatch(IDENTIFIERS);
  });

  it("asks for profiles in batches of 25", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(i, "corteo in centro", `did:plc:user${i}`));
    const { client, getProfiles } = fake(posts);
    await createBlueskyAdapter(async () => client).fetch(ctxWith({ ...env, BLUESKY_KEYWORDS: "corteo", BLUESKY_PLACES: "bologna" }));
    expect(getProfiles.mock.calls.map((c) => c[0].length)).toEqual([25, 5]);
  });

  it("reports missing credentials instead of failing", async () => {
    const res = await createBlueskyAdapter(async () => fake([]).client).fetch(ctxWith({ SOURCE_BLUESKY_ENABLED: "true" }));
    expect(res).toEqual({ items: [], failedFeeds: ["bluesky (BSKY_HANDLE/BSKY_APP_PASSWORD not set)"] });
  });

  it("skips queries that hit a rate limit", async () => {
    const { client } = fake([post(1, "corteo")]);
    client.searchPosts.mockRejectedValueOnce(Object.assign(new Error("Rate Limit Exceeded"), { status: 429 }));
    const res = await createBlueskyAdapter(async () => client).fetch(ctxWith(env));
    // The 429 pauses the service, so the remaining queries are skipped too.
    expect(res.failedFeeds.length).toBeGreaterThan(0);
    expect(res.items).toEqual([]);
  });
});

describe("sealed session storage", () => {
  const session = { accessJwt: "a.b.c", refreshJwt: "d.e.f", did: "did:plc:me", handle: "me.bsky.social", active: true };

  it("round-trips with the same secret, and hides the tokens", () => {
    const sealed = seal(session, "xxxx-xxxx");
    expect(sealed).toMatch(/^v1./);
    expect(sealed).not.toContain("a.b.c");
    expect(unseal(sealed, "xxxx-xxxx")).toEqual(session);
  });

  it("refuses a different secret, tampering and garbage", () => {
    const sealed = seal(session, "xxxx-xxxx");
    expect(unseal(sealed, "other-password")).toBeNull();
    expect(unseal(sealed.slice(0, -2) + "AA", "xxxx-xxxx")).toBeNull();
    expect(unseal("not sealed", "xxxx-xxxx")).toBeNull();
    expect(unseal(undefined, "xxxx-xxxx")).toBeNull();
  });
});

describe("rotate", () => {
  it("wraps around and copes with a changed list", () => {
    expect(rotate(["a", "b", "c"], 2, 2)).toEqual({ queries: ["c", "a"], next: 1 });
    expect(rotate(["a", "b"], 7, 5)).toEqual({ queries: ["b", "a"], next: 1 });
    expect(rotate([], 3, 2)).toEqual({ queries: [], next: 0 });
  });
});

describe("mastodon", () => {
  const status = (id: string, content: string, extra: Record<string, unknown> = {}) => ({
    id,
    uri: `https://mastodon.uno/users/mario.rossi/statuses/${id}`,
    url: `https://mastodon.uno/@mario.rossi/${id}`,
    created_at: "2026-10-21T11:30:00.000Z",
    content,
    spoiler_text: "",
    reblog: null,
    account: { username: "mario.rossi", acct: "mario.rossi", display_name: "Mario Rossi", followers_count: 42, created_at: "2025-10-21T00:00:00.000Z" },
    ...extra,
  });

  function setup(byTag: Record<string, unknown[]>) {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const tag = decodeURIComponent(new URL(String(url)).pathname.split("/").pop()!);
      return Response.json(byTag[tag] ?? []);
    });
    return { fetchImpl, ctx: (cursors?: Record<string, string>, env: Record<string, string> = {}) => ctxWith({ SOURCE_MASTODON_ENABLED: "true", ...env }, fetchImpl as unknown as typeof fetch, cursors) };
  }

  it("reads the default tags with since_id and strips HTML", async () => {
    const { fetchImpl, ctx } = setup({
      bologna: [
        status("9007199254740993", '<p>Corteo in <a href="https://mastodon.uno/tags/bologna">#bologna</a>, <span class="h-card"><a href="https://mastodon.uno/@luigi">@luigi</a></span> sei qui?</p>'),
        status("9007199254740990", "<p>Buongiorno Bologna</p>"),
      ],
    });
    const res = await mastodonAdapter.fetch(ctx({ "mastodon.uno#bologna": "9007199254740989" }));

    const urls = fetchImpl.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.map((u) => u.pathname)).toEqual([
      "/api/v1/timelines/tag/bologna",
      "/api/v1/timelines/tag/corteobologna",
      "/api/v1/timelines/tag/manifestazionebologna",
    ]);
    expect(urls[0].searchParams.get("since_id")).toBe("9007199254740989");
    expect(urls[1].searchParams.has("since_id")).toBe(false);

    expect(res.items).toHaveLength(1);
    const [item] = res.items;
    expect(item.text).toBe("Corteo in #bologna, @luigi sei qui?"); // handles are scrubbed later by the runner
    expect(item).toMatchObject({ feed: "mastodon.uno", authorMeta: { follower_count: 42, account_age_days: 365 } });
    expect(item.url).toBeUndefined();
    expect(item.externalId).toMatch(/^masto:[0-9a-f]{32}$/);
    // since_id compares as big integers, not strings or floats.
    expect(res.cursors).toEqual({ "mastodon.uno#bologna": "9007199254740993" });
  });

  it("skips boosts and adds extra tags and instances from config", async () => {
    const { fetchImpl, ctx } = setup({ corteo: [status("5", "<p>corteo</p>", { reblog: { id: "1" } })] });
    const res = await mastodonAdapter.fetch(ctx(undefined, { MASTODON_HASHTAGS: "#Corteo", MASTODON_INSTANCES: "https://mastodon.uno,https://mastodon.bida.im" }));
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(res.items).toEqual([]);
  });

  it("drops stored fields that could identify the author", async () => {
    const { ctx } = setup({ bologna: [status("7", "<p>Scontri in piazza Verdi</p>")] });
    const store = new MemoryIngestStore(() => NOW);
    await runAdapter(mastodonAdapter, ctx(), store);
    expect(store.raw).toHaveLength(1);
    expect(JSON.stringify(store.raw[0])).not.toMatch(IDENTIFIERS);
    expect(store.cursors.get("mastodon")).toEqual({ "mastodon.uno#bologna": "7" });
  });
});

describe("telegram", () => {
  const env = { SOURCE_TELEGRAM_ENABLED: "true", TG_API_ID: "12345", TG_API_HASH: "abc", TG_SESSION: "1Aa", TELEGRAM_CHANNELS: "bolognanews,comunebologna" };

  function fake(byChannel: Record<string, { id: number; date: number; message?: string }[]>) {
    const getMessages = vi.fn<TgClient["getMessages"]>(async (channel, opts) => (byChannel[channel] ?? []).filter((m) => m.id > opts.minId));
    return { client: { getMessages }, getMessages };
  }

  it("reads only the configured public channels from the saved message id", async () => {
    const date = Math.floor(NOW.getTime() / 1000) - 600;
    const { client, getMessages } = fake({
      bolognanews: [
        { id: 101, date, message: "Corteo in via Rizzoli, traffico bloccato" },
        { id: 102, date, message: "Meteo: sole tutto il giorno" },
      ],
    });
    const res = await createTelegramAdapter(async () => client).fetch(ctxWith(env, undefined, { bolognanews: "100" }));

    expect(getMessages.mock.calls).toEqual([
      ["bolognanews", { limit: 50, minId: 100 }],
      ["comunebologna", { limit: 20, minId: 0 }],
    ]);
    expect(res.items).toEqual([
      { feed: "bolognanews", externalId: "tg:bolognanews/101", text: "Corteo in via Rizzoli, traffico bloccato", url: "https://t.me/bolognanews/101", publishedAt: new Date(date * 1000) },
    ]);
    expect(res.cursors).toEqual({ bolognanews: "102" });
  });

  it("treats FLOOD_WAIT as a rate limit and skips the channel", async () => {
    const { client } = fake({});
    client.getMessages.mockRejectedValueOnce(Object.assign(new Error("FLOOD_WAIT_30"), { seconds: 30 }));
    const res = await createTelegramAdapter(async () => client).fetch(ctxWith(env));
    expect(res.failedFeeds).toEqual(["bolognanews", "comunebologna"]); // paused for 30s after the first
  });

  it("does nothing without credentials, and refuses non-public channel names", async () => {
    const res = await createTelegramAdapter(async () => fake({}).client).fetch(ctxWith({ SOURCE_TELEGRAM_ENABLED: "true", TELEGRAM_CHANNELS: "bolognanews" }));
    expect(res.failedFeeds).toEqual(["telegram (TG_API_ID/TG_API_HASH/TG_SESSION not set)"]);
    expect(() => parseEnv({ ...BASE, TELEGRAM_CHANNELS: "https://t.me/+AbCdEf" })).toThrow();
  });

  it("is disabled by default", () => {
    expect(createTelegramAdapter().enabled(parseEnv(BASE))).toBe(false);
  });
});

describe("adaptive polling", () => {
  it("speeds up after relevant items and slows down after empty polls, within bounds", () => {
    const p = new AdaptivePoller({ baseMinutes: 5, minMinutes: 2, maxMinutes: 20 });
    const intervals: number[] = [];
    let t = NOW.getTime();
    for (const found of [true, true, true, false, false, false, false, false, false]) {
      p.record(found, new Date(t));
      intervals.push(p.interval);
      t += p.interval * 60_000;
    }
    expect(intervals).toEqual([2, 2, 2, 3, 5, 8, 12, 18, 20]);
  });

  it("is due again only after the interval", () => {
    const p = new AdaptivePoller({ baseMinutes: 5, minMinutes: 2, maxMinutes: 20 });
    expect(p.due(NOW)).toBe(true);
    p.record(false, NOW); // → 8 min
    expect(p.due(new Date(NOW.getTime() + 7 * 60_000))).toBe(false);
    expect(p.due(new Date(NOW.getTime() + 8 * 60_000))).toBe(true);
  });
});

describe("cursors", () => {
  it("are saved only after the items are stored", async () => {
    const store = new MemoryIngestStore(() => NOW);
    store.insertRawItems = async () => {
      throw new Error("db down");
    };
    const { client } = { client: { getMessages: async () => [{ id: 5, date: NOW.getTime() / 1000, message: "corteo in centro" }] } };
    const adapter = createTelegramAdapter(async () => client);
    const s = await runAdapter(adapter, ctxWith({ SOURCE_TELEGRAM_ENABLED: "true", TG_API_ID: "1", TG_API_HASH: "h", TG_SESSION: "s", TELEGRAM_CHANNELS: "bolognanews" }), store);
    expect(s.status).toBe("error");
    expect(store.cursors.get("telegram")).toBeUndefined();
  });
});
