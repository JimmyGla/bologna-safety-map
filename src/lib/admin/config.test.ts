import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { workerConfig } from "@/worker/config-report";
import { resolveConfig } from "./config";

const NOW = new Date("2026-10-22T08:00:00Z");
// The website on Vercel: none of the worker's variables are set.
const websiteEnv = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" });
// The worker on GitHub Actions.
const workerEnv = parseEnv({
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  LLM_PROVIDER: "gemini",
  GEMINI_API_KEY: "k",
  SOURCE_NEWS_ENABLED: "true",
  SOURCE_TELEGRAM_ENABLED: "true",
});
const adapters = ["news", "tper", "reddit", "bluesky", "mastodon", "telegram"].map((id) => ({
  id,
  enabled: (e: typeof workerEnv) => (id === "news" ? e.SOURCE_NEWS_ENABLED : id === "telegram" ? e.SOURCE_TELEGRAM_ENABLED : false),
}));

describe("workerConfig", () => {
  it("reports provider, model, sources and commit, without secrets", () => {
    const c = workerConfig(workerEnv, { name: "gemini" }, adapters, "e1e91f3abcdef");
    expect(c).toEqual({
      llmProvider: "gemini",
      extractor: "gemini",
      model: `${workerEnv.GEMINI_MODEL} (fallback gemini-flash-lite-latest)`,
      sources: { news: true, tper: false, reddit: false, bluesky: false, mastodon: false, telegram: true },
      commit: "e1e91f3",
    });
    expect(JSON.stringify(c)).not.toContain('"k"');
  });

  it("explains when the configured extractor can't start", () => {
    const noKey = parseEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db", LLM_PROVIDER: "gemini" });
    expect(workerConfig(noKey, { name: "rules" }, adapters, "")).toMatchObject({ extractor: "rules", note: "GEMINI_API_KEY is empty" });
  });
});

describe("resolveConfig", () => {
  const row = (minutesAgo: number, details: unknown) => ({ lastRunAt: new Date(NOW.getTime() - minutesAgo * 60_000), details });

  it("shows the worker's own configuration when it reported recently", () => {
    const c = resolveConfig(websiteEnv, row(1, workerConfig(workerEnv, { name: "gemini" }, adapters, "e1e91f3")), NOW);
    expect(c.from).toBe("worker");
    expect(c.enabled("telegram")).toBe(true);
    expect(c.enabled("bluesky")).toBe(false);
    expect(c.extractor).toMatchObject({ configured: "gemini", active: "gemini", model: `${workerEnv.GEMINI_MODEL} (fallback gemini-flash-lite-latest)` });
    expect(c.commit).toBe("e1e91f3");
  });

  it("falls back to the website's settings when the report is old, missing or malformed", () => {
    const good = workerConfig(workerEnv, { name: "gemini" }, adapters, "");
    for (const r of [row(45, good), null, row(1, { nonsense: true })]) {
      const c = resolveConfig(websiteEnv, r, NOW);
      expect(c.from).toBe("website");
      expect(c.enabled("telegram")).toBe(false);
      expect(c.extractor.configured).toBe("rules");
    }
  });
});
