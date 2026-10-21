import type { AuthorMeta, RawSource, SourceClass } from "@/db/schema";

/**
 * Public Telegram channels run by public bodies, counted as official sources (rule 3).
 * Lower-case usernames. Kept in code, not env, so adding one is a reviewed change.
 */
export const OFFICIAL_TELEGRAM_CHANNELS: ReadonlySet<string> = new Set([
  "comunebologna", // Comune di Bologna
]);

/** `feed` is the channel/feed within the source; it only matters for Telegram. */
export function sourceClassOf(source: RawSource, feed?: string): SourceClass {
  switch (source) {
    case "telegram":
      return feed && OFFICIAL_TELEGRAM_CHANNELS.has(feed.toLowerCase()) ? "official" : "social";
    case "official":
      return "official";
    case "news":
      return "news";
    case "tper":
      return "transit";
    default:
      return "social";
  }
}

const BASE: Record<Exclude<SourceClass, "social">, number> = { official: 1, news: 0.85, transit: 0.8 };
const SOCIAL_BASE = 0.3;
const SOCIAL_MAX = 0.7;

/** How much we trust the source of an event (0..1). */
export function credibility(cls: SourceClass, meta?: AuthorMeta | null, isFirsthand = false): number {
  if (cls !== "social") return BASE[cls];
  let c = SOCIAL_BASE;
  if ((meta?.account_age_days ?? 0) > 365) c += 0.1;
  if ((meta?.follower_count ?? 0) > 1_000) c += 0.1;
  if (isFirsthand) c += 0.1;
  return Math.round(Math.min(SOCIAL_MAX, c) * 100) / 100;
}

/** Rules-based extractions are less reliable than an LLM's. */
export const RULES_CONFIDENCE_FACTOR = 0.8;
