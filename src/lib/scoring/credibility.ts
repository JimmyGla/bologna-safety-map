import type { AuthorMeta, RawSource, SourceClass } from "@/db/schema";

export function sourceClassOf(source: RawSource): SourceClass {
  switch (source) {
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
