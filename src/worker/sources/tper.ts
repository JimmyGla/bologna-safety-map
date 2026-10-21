import { parse } from "node-html-parser";
import { lookup, toCells } from "@/lib/gazetteer";
import { htmlToText, plain } from "../ingest/text";
import type { NewEvent } from "../ingest/store";
import { parseFeed } from "./feed";
import type { FetchedItem, SourceAdapter } from "./types";

// Sources checked 2026-10-21:
// - TPER has no GTFS-RT alerts feed (open data offers static GTFS only), and its RSS feeds
//   carry occasional news, not live diversions.
// - Live diversions are published on the public Telegram channel "Tper info viabilità"
//   (linked from tper.it). We read its public web preview t.me/s/<channel>: stable post
//   ids and timestamps, one request per run, through the quota guard.
// TODO: this is HTML scraping. Replace it if TPER publishes a feed/API for diversions
// (ask TPER), or read the channel through an MTProto client.

export type TelegramPost = { id: string; text: string; published?: Date };

export function parseTelegramPreview(html: string): TelegramPost[] {
  return parse(html)
    .querySelectorAll(".tgme_widget_message[data-post]")
    .map((el) => {
      const body = el.querySelector(".tgme_widget_message_text");
      const time = el.querySelector("time[datetime]")?.getAttribute("datetime");
      const published = time ? new Date(time) : undefined;
      return {
        id: el.getAttribute("data-post")!,
        text: body ? htmlToText(body.innerHTML) : "",
        published: published && !Number.isNaN(published.getTime()) ? published : undefined,
      };
    })
    .filter((p) => p.text);
}

// "manifestazione" is also TPER's word for fairs and festivals, so it only counts when
// no event word is present. Corteo/presidio/disordini always count.
const STRONG = /\b(cort(eo|ei)|presidi[oi]?|disordini|manifestant[ei]|scontri|tensioni)\b/;
const WEAK = /\bmanifestazion[ei]\b/;
const NON_PROTEST = /\b(sagr[ae]|fest[ae]|festival|concert[oi]|fier[ae]|mercat\w*|maratona|gara|podistic\w*|ciclistic\w*|processione|carnevale|partita|storico|natale|tartufo)\b/;
const SEVERE = /\b(disordini|scontri|tensioni)\b/;

/** Is this a Bologna service change caused by a protest? */
export function isProtestDiversion(text: string): boolean {
  const t = plain(text);
  if (!STRONG.test(t) && !(WEAK.test(t) && !NON_PROTEST.test(t))) return false;
  // Posts are tagged with the town ("#Bologna", "#Savigno"): other towns are out of scope.
  const towns = [...text.matchAll(/#([A-Za-zÀ-ÿ]+)/g)].map((m) => plain(m[1]));
  const otherTown = towns.length > 0 && !towns.includes("bologna");
  return !otherTown;
}

export const tperAdapter: SourceAdapter = {
  id: "tper",
  source: "tper",
  sourceClass: "transit",
  schedule: "*/5 * * * *",
  enabled: (env) => env.SOURCE_TPER_ENABLED,

  async fetch(ctx) {
    const items: FetchedItem[] = [];
    const failedFeeds: string[] = [];
    const headers = { "User-Agent": ctx.userAgent };

    const channel = ctx.env.TPER_TELEGRAM_CHANNEL;
    const tg = await ctx.guard.fetch("telegram", `https://t.me/s/${encodeURIComponent(channel)}`, { headers });
    if (tg?.ok) {
      for (const p of parseTelegramPreview(await tg.text())) {
        if (!isProtestDiversion(p.text)) continue;
        items.push({ feed: "telegram", externalId: `tg:${p.id}`, text: p.text, url: `https://t.me/${p.id}`, publishedAt: p.published });
      }
    } else {
      failedFeeds.push("telegram");
    }

    const rss = await ctx.guard.fetch("tper", ctx.env.TPER_RSS_URL, { headers });
    if (rss?.ok) {
      for (const e of parseFeed(await rss.text())) {
        const text = `${e.title}. ${htmlToText(e.html)}`.trim();
        if (!e.id || !isProtestDiversion(text)) continue;
        items.push({ feed: "rss", externalId: e.id, text, url: e.link, publishedAt: e.published });
      }
    } else {
      failedFeeds.push("rss");
    }
    return { items, failedFeeds };
  },

  // Protest diversions become blockade events directly (no LLM needed).
  signals(items, ctx) {
    return items.map((item): NewEvent => {
      const matches = lookup(item.text);
      // Prefer streets/squares over whole neighbourhoods when both are named.
      const specific = matches.filter((m) => m.type !== "area");
      const used = specific.length ? specific : matches;
      const cells = new Set(used.flatMap((m) => toCells(m.geometry)));
      return {
        rawItemId: item.id,
        source: "tper",
        sourceFeed: `tper:${item.feed}`,
        eventType: "blockade",
        severity: SEVERE.test(plain(item.text)) ? 2 : 1,
        confidence: 0.7,
        isFirsthand: true, // the operator reporting its own service
        credibility: 0.9,
        occurredAt: item.publishedAt ?? ctx.now(),
        locationNames: used.map((m) => m.name),
        h3Cells: [...cells].sort(),
        sourceClass: "transit",
        extractor: "rules",
      };
    });
  },
};
