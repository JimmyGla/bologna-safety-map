import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("parseEnv", () => {
  it("works with only DATABASE_URL: rules provider, all sources off", () => {
    const env = parseEnv(base);
    expect(env.LLM_PROVIDER).toBe("rules");
    expect(env.SOURCE_NEWS_ENABLED).toBe(false);
    expect(env.QUOTA_LIMITS).toEqual({});
    expect(env.NEWS_RSS_URLS).toEqual([]);
  });

  it("treats empty values as unset", () => {
    const env = parseEnv({ ...base, GEMINI_API_KEY: "", TPER_TELEGRAM_CHANNEL: "", REDDIT_SUBREDDITS: "" });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.TPER_TELEGRAM_CHANNEL).toBe("TperInfoViabilita");
    expect(env.REDDIT_SUBREDDITS).toEqual(["bologna"]);
  });

  it("parses flags and comma lists", () => {
    const env = parseEnv({
      ...base,
      SOURCE_REDDIT_ENABLED: "true",
      REDDIT_SUBREDDITS: "bologna, italy ,",
    });
    expect(env.SOURCE_REDDIT_ENABLED).toBe(true);
    expect(env.REDDIT_SUBREDDITS).toEqual(["bologna", "italy"]);
  });

  it("parses QUOTA_LIMITS overrides", () => {
    const env = parseEnv({ ...base, QUOTA_LIMITS: "gemini=10/250, Bluesky=30/3000" });
    expect(env.QUOTA_LIMITS).toEqual({
      gemini: { perMinute: 10, perDay: 250 },
      bluesky: { perMinute: 30, perDay: 3000 },
    });
  });

  it("rejects malformed QUOTA_LIMITS", () => {
    expect(() => parseEnv({ ...base, QUOTA_LIMITS: "gemini=10" })).toThrow();
  });

  it("rejects an unknown LLM_PROVIDER", () => {
    expect(() => parseEnv({ ...base, LLM_PROVIDER: "anthropic" })).toThrow();
  });
});
