import { z } from "zod";
import { DEFAULT_THRESHOLDS, parseThresholds } from "@/lib/scoring";

// Server-only. Never import from client components.

const list = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const withDefault = (fallback: string[]) => list.transform((l) => (l.length ? l : fallback));

const flag = z.stringbool().default(false);

export type QuotaOverrides = Record<string, { perMinute: number; perDay: number }>;

// "service=perMinute/perDay,..." e.g. "gemini=10/250,bluesky=30/3000".
// Overrides the free-tier defaults in src/lib/quota.ts (CLAUDE.md rule 5).
// Returns an error message instead of throwing so zod and quota.ts can both use it.
export function parseQuotaLimits(s: string): QuotaOverrides | string {
  const limits: QuotaOverrides = {};
  for (const entry of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_-]+)=(\d+)\/(\d+)$/i.exec(entry);
    if (!m) return `Invalid QUOTA_LIMITS entry: "${entry}"`;
    limits[m[1].toLowerCase()] = { perMinute: Number(m[2]), perDay: Number(m[3]) };
  }
  return limits;
}

const quotaLimits = z
  .string()
  .default("")
  .transform((s, ctx) => {
    const parsed = parseQuotaLimits(s);
    if (typeof parsed === "string") {
      ctx.addIssue({ code: "custom", message: parsed });
      return z.NEVER;
    }
    return parsed;
  });

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  /** Neon direct (non-pooled) URL for the worker and migrations. Falls back to DATABASE_URL. */
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  /** "neon" (HTTP, default on Vercel) or "postgres" (TCP pool, default elsewhere). */
  DB_DRIVER: z.enum(["neon", "postgres"]).optional(),
  /** Apply pending migrations when the worker starts (default on). */
  MIGRATE_ON_START: z.stringbool().default(true),
  /** /api/cells requests per minute per client IP. */
  CELLS_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  /** Enables /admin (min. 12 characters). Read directly by the admin routes. */
  ADMIN_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  // LLM (CLAUDE.md "LLM"): falls back to "rules" automatically.
  LLM_PROVIDER: z.enum(["gemini", "ollama", "rules"]).default("rules"),
  GEMINI_API_KEY: z.string().optional(),
  // "-latest" alias tracks the current free-tier Flash model; pin a version if it changes behaviour.
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  // Free-tier limits for that model (requests per minute / per day). Check AI Studio.
  GEMINI_RPM: z.coerce.number().int().positive().default(10),
  GEMINI_RPD: z.coerce.number().int().positive().default(250),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:7b"),

  QUOTA_LIMITS: quotaLimits,
  // Score boundaries for levels 0|1|2|3 (src/lib/scoring.ts).
  SCORE_THRESHOLDS: z
    .string()
    .default(DEFAULT_THRESHOLDS.join(","))
    .transform((s, ctx) => {
      const t = parseThresholds(s);
      if (typeof t === "string") {
        ctx.addIssue({ code: "custom", message: t });
        return z.NEVER;
      }
      return t;
    }),
  SOURCE_USER_AGENT: z.string().default("bologna-safety-map/0.1"),

  // Sources (CLAUDE.md "Sources"): each can be switched on/off.
  SOURCE_NEWS_ENABLED: flag,
  NEWS_RSS_URLS: list,
  SOURCE_TPER_ENABLED: flag,
  TPER_TELEGRAM_CHANNEL: z.string().default("TperInfoViabilita"),
  TPER_RSS_URL: z.string().url().default("https://www.tper.it/taxonomy/term/33/all/rss.xml"),
  SOURCE_BLUESKY_ENABLED: flag,
  BSKY_HANDLE: z.string().optional(),
  BSKY_APP_PASSWORD: z.string().optional(),
  // Each search is "<keyword> <place>" for every pair (keep the product small: quota).
  BLUESKY_KEYWORDS: withDefault(["corteo", "manifestazione", "scontri", "presidio"]),
  BLUESKY_PLACES: withDefault(["bologna", "zona universitaria", "bolognina"]),
  // Searched with the first place only ("bologna"), to keep the number of searches down.
  BLUESKY_VIOLENCE_KEYWORDS: withDefault([
    "aggressione", "aggredito", "aggredita", "pestaggio", "accoltellato", "rissa", "squadristi", "violenza sessuale", "molestie", "vandali",
  ]),
  // Searches per run; the full list is rotated across runs (see src/worker/sources/bluesky.ts).
  BLUESKY_QUERIES_PER_RUN: z.coerce.number().int().min(1).max(50).default(8),
  SOURCE_MASTODON_ENABLED: flag,
  MASTODON_INSTANCES: withDefault(["https://mastodon.uno"]).pipe(z.array(z.string().url())),
  /** Extra tags on top of bologna, corteobologna, manifestazionebologna. */
  MASTODON_HASHTAGS: list,
  SOURCE_REDDIT_ENABLED: flag,
  REDDIT_SUBREDDITS: withDefault(["bologna"]),
  SOURCE_TELEGRAM_ENABLED: flag,
  /** Public channel usernames only (no invite links, no groups). */
  TELEGRAM_CHANNELS: list.pipe(z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, "public channel username"))),
  // my.telegram.org app credentials + session from `npm run telegram:login`.
  TG_API_ID: z.coerce.number().int().positive().optional(),
  TG_API_HASH: z.string().optional(),
  TG_SESSION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Quota overrides: QUOTA_LIMITS plus the Gemini limits (QUOTA_LIMITS wins if both set). */
export function quotaOverrides(env: Env): QuotaOverrides {
  return { gemini: { perMinute: env.GEMINI_RPM, perDay: env.GEMINI_RPD }, ...env.QUOTA_LIMITS };
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings (KEY= in .env files) as unset so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  return envSchema.parse(cleaned);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
