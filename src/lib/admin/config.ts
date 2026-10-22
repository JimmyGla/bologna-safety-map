import type { Env } from "@/lib/env";
import { WORKER_CONFIG_MAX_AGE_MS, workerConfigSchema, type WorkerConfig } from "@/lib/worker-config";

// Pure helpers for /admin (no database), so they can be tested on their own.

export const SOURCE_FLAGS: Record<string, (env: Env) => boolean> = {
  news: (e) => e.SOURCE_NEWS_ENABLED,
  tper: (e) => e.SOURCE_TPER_ENABLED,
  reddit: (e) => e.SOURCE_REDDIT_ENABLED,
  bluesky: (e) => e.SOURCE_BLUESKY_ENABLED,
  mastodon: (e) => e.SOURCE_MASTODON_ENABLED,
  telegram: (e) => e.SOURCE_TELEGRAM_ENABLED,
};

/** The extractor a worker with the website's env would use (fallback when the worker hasn't reported). */
export function effectiveExtractor(env: Env): { configured: string; active: string; note?: string } {
  if (env.LLM_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
    return { configured: "gemini", active: "rules", note: "GEMINI_API_KEY is empty" };
  }
  return { configured: env.LLM_PROVIDER, active: env.LLM_PROVIDER };
}

/**
 * Which configuration /admin shows. The worker reports its own on every run (it has its own
 * env, e.g. GitHub Actions variables); the website's env is only a fallback, labelled as such.
 */
export function resolveConfig(
  env: Env,
  workerRow: { lastRunAt: Date; details: unknown } | null | undefined,
  now: Date,
): {
  from: "worker" | "website";
  reportedAt: Date | null;
  commit?: string;
  enabled: (sourceId: string) => boolean;
  extractor: { configured: string; active: string; model?: string; note?: string };
} {
  const parsed = workerRow ? workerConfigSchema.safeParse(workerRow.details) : null;
  const fresh = !!workerRow && now.getTime() - workerRow.lastRunAt.getTime() <= WORKER_CONFIG_MAX_AGE_MS;
  if (parsed?.success && fresh) {
    const w: WorkerConfig = parsed.data;
    return {
      from: "worker",
      reportedAt: workerRow!.lastRunAt,
      commit: w.commit,
      enabled: (id) => w.sources[id] ?? false,
      extractor: { configured: w.llmProvider, active: w.extractor, model: w.model, note: w.note },
    };
  }
  return {
    from: "website",
    reportedAt: null,
    enabled: (id) => SOURCE_FLAGS[id]?.(env) ?? false,
    extractor: effectiveExtractor(env),
  };
}
