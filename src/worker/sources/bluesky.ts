import type { AtpSessionData } from "@atproto/api";
import type { AuthorMeta } from "@/db/schema";
import type { Env } from "@/lib/env";
import { errInfo, logger } from "@/lib/log";
import { daysSince, hashedId } from "../ingest/ids";
import { isSafetyRelated } from "../ingest/text";
import { seal, unseal } from "./sealed";
import type { FetchedItem, SourceAdapter } from "./types";

// Bluesky search (app.bsky.feed.searchPosts) with a free account + app password.
// Stored per post: text, time, follower count and account age. Never the DID, handle,
// display name or post URL (the URL contains the DID).
//
// Budget: the worker runs every 5 minutes, often in a new process. So:
// - searches are rotated: each run does BLUESKY_QUERIES_PER_RUN of them, continuing where the
//   last run stopped (cursor "next"); each search remembers when it last ran ("since:<q>");
// - the login session is saved (encrypted, cursor "session") and resumed, instead of logging
//   in every run: Bluesky limits logins per account per day.

const blog = logger("bluesky");

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

/** A client plus its current session, sealed for storage (unchanged sessions keep their seal). */
export type BskyConnection = { client: BskyClient; sealedSession?: () => string | undefined };

/** Makes a client; gets the sealed session saved by the previous run, if any. */
export type BskyConnect = (env: Env, savedSession: string | undefined) => Promise<BskyClient | BskyConnection>;

const PROFILES_PER_CALL = 25; // API limit
const FIRST_RUN_LOOKBACK_MS = 2 * 3_600_000;
/** Re-read a little before the last search, for posts indexed late. */
const OVERLAP_MS = 5 * 60_000;

const quoted = (s: string) => (s.includes(" ") ? `"${s}"` : s);

/**
 * Every protest keyword × place, plus every violence keyword with the first place
 * ("bologna"): the violence words are many, and posts about them name the city.
 */
export function blueskyQueries(
  env: Pick<Env, "BLUESKY_KEYWORDS" | "BLUESKY_PLACES" | "BLUESKY_VIOLENCE_KEYWORDS">,
): string[] {
  const protest = env.BLUESKY_KEYWORDS.flatMap((k) => env.BLUESKY_PLACES.map((p) => `${quoted(k)} ${quoted(p)}`));
  const city = env.BLUESKY_PLACES[0];
  const violence = env.BLUESKY_VIOLENCE_KEYWORDS.map((k) => `${quoted(k)} ${quoted(city)}`);
  return [...new Set([...protest, ...violence])];
}

/** The next `count` searches after `start`, wrapping around; and where the next run starts. */
export function rotate(queries: string[], start: number, count: number): { queries: string[]; next: number } {
  if (!queries.length) return { queries: [], next: 0 };
  const from = ((Math.trunc(start) % queries.length) + queries.length) % queries.length;
  const n = Math.min(count, queries.length);
  return { queries: Array.from({ length: n }, (_, i) => queries[(from + i) % queries.length]), next: (from + n) % queries.length };
}

async function connectAgent(env: Env, savedSession: string | undefined): Promise<BskyConnection> {
  const { AtpAgent } = await import("@atproto/api");
  const secret = env.BSKY_APP_PASSWORD!;
  let current: AtpSessionData | undefined;
  const agent = new AtpAgent({ service: "https://bsky.social", persistSession: (_evt, s) => void (current = s) });

  const saved = unseal<AtpSessionData>(savedSession, secret);
  let resumed = false;
  if (saved) {
    try {
      await agent.resumeSession(saved);
      resumed = true;
    } catch (err) {
      blog.info(errInfo(err), "saved session no longer valid; logging in");
    }
  }
  if (!resumed) await agent.login({ identifier: env.BSKY_HANDLE!, password: secret });
  blog.info({ resumed }, resumed ? "resumed saved session" : "logged in");
  current ??= agent.session;

  const savedJson = saved ? JSON.stringify(saved) : undefined;
  return {
    client: {
      async searchPosts(params) {
        const res = await agent.app.bsky.feed.searchPosts(params);
        return { posts: res.data.posts as unknown as BskyPost[] };
      },
      async getProfiles(actors) {
        const res = await agent.app.bsky.actor.getProfiles({ actors });
        return res.data.profiles;
      },
    },
    // Re-seal only when the tokens changed, so an unchanged session isn't rewritten each run.
    sealedSession: () => (!current ? undefined : JSON.stringify(current) === savedJson ? savedSession : seal(current, secret)),
  };
}

export function createBlueskyAdapter(connect: BskyConnect = connectAgent): SourceAdapter {
  // In a long-running worker the connection is kept for the whole process.
  let shared: Promise<BskyConnection> | undefined;
  const connectionFor = (env: Env, savedSession: string | undefined) => {
    shared ??= connect(env, savedSession)
      .then((c) => ("searchPosts" in c ? { client: c } : c))
      .catch((err) => {
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
      const conn = await guard.run("bluesky", () => connectionFor(env, ctx.cursors?.session));
      if (!conn) return { items: [], failedFeeds: ["bluesky (login failed)"] };
      const { client } = conn;

      const now = ctx.now().getTime();
      const turn = rotate(blueskyQueries(env), Number(ctx.cursors?.next ?? 0) || 0, env.BLUESKY_QUERIES_PER_RUN);
      const posts = new Map<string, BskyPost>();
      const failedFeeds: string[] = [];
      const cursors: Record<string, string> = { next: String(turn.next) };
      for (const q of turn.queries) {
        // Each search continues from its own last run ("since" is the pre-rotation cursor).
        const last = ctx.cursors?.[`since:${q}`] ?? ctx.cursors?.since;
        const from = Math.max(last ? new Date(last).getTime() - OVERLAP_MS : 0, now - FIRST_RUN_LOOKBACK_MS);
        const res = await guard.run("bluesky", () =>
          client.searchPosts({ q, lang: "it", sort: "latest", since: new Date(from).toISOString(), limit: 50 }),
        );
        if (!res) {
          failedFeeds.push(`search "${q}"`); // its cursor stays, so the next turn covers the gap
          continue;
        }
        cursors[`since:${q}`] = new Date(now).toISOString();
        for (const p of res.posts) posts.set(p.uri, p);
      }

      const relevant = [...posts.values()].filter((p) => p.record.text && isSafetyRelated(p.record.text));

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

      const session = conn.sealedSession?.();
      if (session) cursors.session = session;
      return { items, failedFeeds, cursors };
    },
  };
}

export const blueskyAdapter = createBlueskyAdapter();
