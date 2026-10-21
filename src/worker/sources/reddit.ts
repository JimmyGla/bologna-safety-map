import { htmlToText, isProtestRelated } from "../ingest/text";
import { parseFeed } from "./feed";
import type { FetchedItem, SourceAdapter } from "./types";

/**
 * Post body without Reddit's footer ("submitted by /u/name [link] [comments]").
 * The Atom <author> element is never read (CLAUDE.md rule 1).
 */
export function redditBody(html: string): string {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").split(/submitted by/i)[0];
  return htmlToText(body);
}

export const redditAdapter: SourceAdapter = {
  id: "reddit",
  source: "reddit",
  sourceClass: "social",
  schedule: "*/10 * * * *",
  // Reddit throttles hard (see quota.ts): never faster than every 5 minutes.
  adaptive: { baseMinutes: 10, minMinutes: 5, maxMinutes: 30 },
  enabled: (env) => env.SOURCE_REDDIT_ENABLED,

  async fetch(ctx) {
    const items: FetchedItem[] = [];
    const failedFeeds: string[] = [];
    for (const sub of ctx.env.REDDIT_SUBREDDITS) {
      // Reddit throttles generic agents; it asks for a descriptive platform:app:version form.
      const res = await ctx.guard.fetch("reddit", `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`, {
        headers: { "User-Agent": `node:bologna-safety-map:v0.1 (${ctx.userAgent}; area-level protest map)` },
      });
      if (!res?.ok) {
        failedFeeds.push(`r/${sub}`);
        continue;
      }
      for (const e of parseFeed(await res.text())) {
        const text = [e.title, redditBody(e.html)].filter(Boolean).join(". ");
        if (!e.id || !isProtestRelated(text)) continue;
        items.push({ feed: `r/${sub}`, externalId: e.id, text, url: e.link, publishedAt: e.published });
      }
    }
    return { items, failedFeeds };
  },
};
