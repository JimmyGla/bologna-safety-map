import { blueskyAdapter } from "./bluesky";
import { mastodonAdapter } from "./mastodon";
import { newsAdapter } from "./news";
import { redditAdapter } from "./reddit";
import { telegramAdapter } from "./telegram";
import { tperAdapter } from "./tper";
import type { SourceAdapter } from "./types";

// X/Twitter is deliberately absent: CLAUDE.md rule 4 (no X API, no scraping X).
export const ADAPTERS: SourceAdapter[] = [newsAdapter, tperAdapter, redditAdapter, blueskyAdapter, mastodonAdapter, telegramAdapter];
