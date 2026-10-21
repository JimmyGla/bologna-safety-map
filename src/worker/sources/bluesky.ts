import type { AuthorMeta } from "@/db/schema";
import type { Env } from "@/lib/env";
import { daysSince, hashedId } from "../ingest/ids";
import { isProtestRelated } from "../ingest/text";
import type { FetchedItem, SourceAdapter } from "./types";

// Bluesky search (app.bsky.feed.searchPosts) with a free account + app password.
// Stored per post: text, time, follower count and account age. Never the DID, handle,
// display name or post URL (the URL contains the DID).

export type BskyPost = {
  uri: string;
  author: { did: string };
  record: { text?: string; createdAt?: string };
  indexedAt: string;
};
export type BskyProfile = { did: string; followersCount?: number; createdAt?: string };

/** The part of @atproto/api we use, so tests can pass a fake. */
export type BskyClient = {
  searchPosts(params: { q: string; lang: string; sort: "latest"; since?: string; limit: number }): Promise<{ posts: BskyPost[] }>;
  getProfiles(actors: string[]): Promise<BskyProfile[]>;
};

const PROFILES_PER_CALL = 25; // API limit
const FIRST_RUN_LOOKBACK_MS = 2 * 3_600_000;

/** "<keyword> <place>" for every pair; multi-word places are quoted. */
export function blueskyQueries(env: Pick<Env, "BLUESKY_KEYWORDS" | "BLUESKY_PLACES">): string[] {
  return env.BLUESKY_KEYWORDS.flatMap((k) => env.BLUESKY_PLACES.map((p) => `${k} ${p.includes(" ") ? `"${p}"` : p}`));
}

let shared: Promise<BskyClient> | undefined;

async function loginClient(handle: string, password: string): Promise<BskyClient> {
  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });
  return {
    async searchPosts(params) {
      const res = await agent.app.bsky.feed.searchPosts(params);
      return { posts: res.data.posts as unknown as BskyPost[] };
    },
    async getProfiles(actors) {
      const res = await agent.app.bsky.actor.getProfiles({ actors });
      return res.data.profiles;
    },
  };
}

export function createBlueskyAdapter(makeClient?: (env: Env) => Promise<BskyClient>): SourceAdapter {
  const clientFor = (env: Env) => {
    if (makeClient) return makeClient(env);
    // One login per process; the agent refreshes its session itself.
    shared ??= loginClient(env.BSKY_HANDLE!, env.BSKY_APP_PASSWORD!).catch((err) => {
      shared = undefined;
      throw err;
    });
    return shared;
  };

  return {
    id: "bluesky",
    source: "bluesky",
    sourceClass: "social",
    schedule: "*/5 * * * *",
    adaptive: { baseMinutes: 5, minMinutes: 2, maxMinutes: 20 },
    enabled: (env) => env.SOURCE_BLUESKY_ENABLED,

    async fetch(ctx) {
      const { env, guard } = ctx;
      if (!env.BSKY_HANDLE || !env.BSKY_APP_PASSWORD) return { items: [], failedFeeds: ["bluesky (BSKY_HANDLE/BSKY_APP_PASSWORD not set)"] };
      const client = await guard.run("bluesky", () => clientFor(env));
      if (!client) return { items: [], failedFeeds: ["bluesky (login failed)"] };

      const since = ctx.cursors?.since ?? new Date(ctx.now().getTime() - FIRST_RUN_LOOKBACK_MS).toISOString();
      const posts = new Map<string, BskyPost>();
      const failedFeeds: string[] = [];
      for (const q of blueskyQueries(env)) {
        const res = await guard.run("bluesky", () => client.searchPosts({ q, lang: "it", sort: "latest", since, limit: 50 }));
        if (!res) {
          failedFeeds.push(`search "${q}"`);
          continue;
        }
        for (const p of res.posts) posts.set(p.uri, p);
      }

      const relevant = [...posts.values()].filter((p) => p.record.text && isProtestRelated(p.record.text));

      // Follower count + account age for the authors of relevant posts only.
      const meta = new Map<string, AuthorMeta>();
      const dids = [...new Set(relevant.map((p) => p.author.did))];
      for (let i = 0; i < dids.length; i += PROFILES_PER_CALL) {
        const profiles = await guard.run("bluesky", () => client.getProfiles(dids.slice(i, i + PROFILES_PER_CALL)));
        for (const pr of profiles ?? []) {
          meta.set(pr.did, { follower_count: pr.followersCount, account_age_days: daysSince(pr.createdAt, ctx.now()) });
        }
      }

      const items: FetchedItem[] = relevant.map((p) => ({
        feed: "search",
        externalId: hashedId("bsky", p.uri),
        text: p.record.text!,
        publishedAt: new Date(p.record.createdAt ?? p.indexedAt),
        authorMeta: meta.get(p.author.did),
      }));

      // Newest post seen (relevant or not) is where the next search starts.
      const newest = [...posts.values()].map((p) => p.record.createdAt ?? p.indexedAt).sort().at(-1);
      return { items, failedFeeds, cursors: newest ? { since: newest } : undefined };
    },
  };
}

export const blueskyAdapter = createBlueskyAdapter();
