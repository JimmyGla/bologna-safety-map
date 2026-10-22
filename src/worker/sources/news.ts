import { htmlToText, isSafetyRelated } from "../ingest/text";
import { parseFeed } from "./feed";
import type { FetchedItem, SourceAdapter } from "./types";

// Google News search (RSS, no key): the last 7 days of Bologna articles about protests and
// street violence, from any outlet. Newsroom feeds only carry their latest articles, so this
// is what gives the forecast a week of history (the runner accepts news up to 7 days old).
const GOOGLE_NEWS_QUERY =
  'bologna (corteo OR manifestazione OR scontri OR presidio OR aggressione OR pestaggio OR squadristi OR "violenza sessuale" OR vandali) when:7d';
export const GOOGLE_NEWS_URL = `https://news.google.com/rss/search?${new URLSearchParams({ q: GOOGLE_NEWS_QUERY, hl: "it", gl: "IT", ceid: "IT:it" })}`;

// Checked 2026-10-21. Repubblica's homepage feed (rss/rss2.0.xml) stopped updating in
// Dec 2023; the cronaca feed is live.
export const DEFAULT_NEWS_FEEDS = [
  { feed: "carlino", url: "https://www.ilrestodelcarlino.it/bologna/rss" },
  { feed: "repubblica", url: "https://bologna.repubblica.it/rss/cronaca/rss2.0.xml" },
  { feed: "bolognatoday", url: "https://www.bolognatoday.it/rss" },
  { feed: "googlenews", url: GOOGLE_NEWS_URL },
];

const feedKey = (url: string) => new URL(url).hostname.replace(/^www\./, "");

export const newsAdapter: SourceAdapter = {
  id: "news",
  source: "news",
  sourceClass: "news",
  schedule: "*/5 * * * *",
  enabled: (env) => env.SOURCE_NEWS_ENABLED,

  async fetch(ctx) {
    const feeds = ctx.env.NEWS_RSS_URLS.length
      ? ctx.env.NEWS_RSS_URLS.map((url) => ({ feed: feedKey(url), url }))
      : DEFAULT_NEWS_FEEDS;
    const items: FetchedItem[] = [];
    const failedFeeds: string[] = [];

    for (const { feed, url } of feeds) {
      const res = await ctx.guard.fetch("news", url, { headers: { "User-Agent": ctx.userAgent } });
      if (!res?.ok) {
        failedFeeds.push(feed);
        continue;
      }
      for (const e of parseFeed(await res.text())) {
        const text = `${e.title}. ${htmlToText(e.html)}`.trim();
        if (!e.id || !isSafetyRelated(text)) continue;
        items.push({ feed, externalId: e.id, text, url: e.link, publishedAt: e.published });
      }
    }
    return { items, failedFeeds };
  },
};
