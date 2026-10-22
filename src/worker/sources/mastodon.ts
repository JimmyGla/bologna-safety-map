import { z } from "zod";
import { daysSince, hashedId } from "../ingest/ids";
import { htmlToText, isSafetyRelated } from "../ingest/text";
import type { FetchedItem, SourceAdapter } from "./types";

// Public hashtag timelines (GET /api/v1/timelines/tag/:tag), no account needed.
// Stored per post: text, time, follower count and account age. Never the account name,
// display name or post URL. One cursor (since_id) per instance + tag.

export const DEFAULT_MASTODON_TAGS = ["bologna", "corteobologna", "manifestazionebologna"];

const statusSchema = z.object({
  id: z.string(),
  uri: z.string(),
  created_at: z.string(),
  content: z.string(),
  spoiler_text: z.string().optional(),
  reblog: z.unknown().nullable().optional(),
  account: z
    .object({ followers_count: z.number().optional(), created_at: z.string().optional(), url: z.string().optional(), acct: z.string().optional() })
    .passthrough(),
});

/** Mastodon ids are numeric strings, possibly beyond 2^53. */
const maxId = (ids: string[]) => ids.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a));

export const mastodonAdapter: SourceAdapter = {
  id: "mastodon",
  source: "mastodon",
  sourceClass: "social",
  schedule: "*/5 * * * *",
  adaptive: { baseMinutes: 5, minMinutes: 2, maxMinutes: 20 },
  enabled: (env) => env.SOURCE_MASTODON_ENABLED,

  async fetch(ctx) {
    const tags = [...new Set([...DEFAULT_MASTODON_TAGS, ...ctx.env.MASTODON_HASHTAGS.map((t) => t.replace(/^#/, "").toLowerCase())])];
    const items: FetchedItem[] = [];
    const failedFeeds: string[] = [];
    const cursors: Record<string, string> = {};

    for (const instance of ctx.env.MASTODON_INSTANCES) {
      const host = new URL(instance).host;
      for (const tag of tags) {
        const key = `${host}#${tag}`;
        const url = new URL(`/api/v1/timelines/tag/${encodeURIComponent(tag)}`, instance);
        url.searchParams.set("limit", "40");
        const since = ctx.cursors?.[key];
        if (since) url.searchParams.set("since_id", since);

        const res = await ctx.guard.fetch("mastodon", url, { headers: { "User-Agent": ctx.userAgent, Accept: "application/json" } });
        const parsed = res?.ok ? z.array(statusSchema).safeParse(await res.json().catch(() => null)) : null;
        if (!parsed?.success) {
          failedFeeds.push(key);
          continue;
        }
        const statuses = parsed.data;
        if (statuses.length) cursors[key] = maxId(statuses.map((s) => s.id));

        for (const s of statuses) {
          if (s.reblog) continue; // boosts repeat someone else's post
          const text = [s.spoiler_text, htmlToText(s.content)].filter(Boolean).join("\n");
          if (!isSafetyRelated(text)) continue;
          items.push({
            feed: host,
            // uri is global across instances (so cross-instance copies dedupe) but contains the username.
            externalId: hashedId("masto", s.uri),
            text,
            publishedAt: new Date(s.created_at),
            authorMeta: { follower_count: s.account.followers_count, account_age_days: daysSince(s.account.created_at, ctx.now()) },
            // The profile URL is the same on every instance; only its keyed form is kept.
            authorKey: s.account.url || s.account.acct ? ctx.authorKey?.(s.account.url || s.account.acct!) : undefined,
          });
        }
      }
    }
    return { items, failedFeeds, cursors };
  },
};
