import { describe, expect, it, vi } from "vitest";
import { QuotaGuard, RateLimitedError, parseRetryAfter } from "./quota";

function setup(overrides = {}, responses: (Response | Error)[] = []) {
  let t = Date.parse("2026-10-21T12:00:00Z");
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const fetchImpl = vi.fn(async () => {
    const r = responses.shift() ?? new Response("ok");
    if (r instanceof Error) throw r;
    return r;
  });
  const guard = new QuotaGuard({
    overrides,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    warn: (m) => warnings.push(m),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { guard, fetchImpl, sleeps, warnings, advance: (ms: number) => (t += ms) };
}

describe("QuotaGuard", () => {
  it("refuses calls over the per-minute limit, then allows them again", async () => {
    const { guard, advance } = setup({ svc: { perMinute: 2, perDay: 100 } });
    expect(await guard.acquire("svc")).toBe(true);
    expect(await guard.acquire("svc")).toBe(true);
    expect(await guard.acquire("svc")).toBe(false);
    advance(60_001);
    expect(await guard.acquire("svc")).toBe(true);
  });

  it("refuses calls over the daily limit until the next UTC day", async () => {
    const { guard, advance } = setup({ svc: { perMinute: 100, perDay: 1 } });
    expect(await guard.acquire("svc")).toBe(true);
    advance(61_000);
    expect(await guard.acquire("svc")).toBe(false);
    advance(12 * 3_600_000);
    expect(await guard.acquire("svc")).toBe(true);
  });

  it("spaces calls by minIntervalMs instead of refusing (nominatim: 1 req/s)", async () => {
    const { guard, sleeps } = setup();
    await guard.acquire("nominatim");
    await guard.acquire("nominatim");
    await guard.acquire("nominatim");
    expect(sleeps).toEqual([1_000, 1_000]);
  });

  it("pauses a service on HTTP 429, honouring Retry-After", async () => {
    const { guard, fetchImpl, advance } = setup({}, [
      new Response("slow down", { status: 429, headers: { "retry-after": "30" } }),
    ]);
    expect(await guard.fetch("news", "https://example.org")).toBeNull();
    expect(await guard.fetch("news", "https://example.org")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(30_001);
    expect(await guard.fetch("news", "https://example.org")).not.toBeNull();
  });

  it("backs off exponentially on repeated 429s without Retry-After", async () => {
    const { guard, advance, warnings } = setup({}, [
      new Response("", { status: 429 }),
      new Response("", { status: 429 }),
    ]);
    await guard.fetch("news", "https://example.org");
    advance(2_001);
    await guard.fetch("news", "https://example.org");
    expect(warnings.filter((w) => w.includes("429"))).toEqual([
      "news: HTTP 429, pausing 2s",
      "news: HTTP 429, pausing 4s",
    ]);
  });

  it("degrades gracefully on network errors and SDK failures", async () => {
    const { guard } = setup({}, [new TypeError("fetch failed")]);
    expect(await guard.fetch("news", "https://example.org")).toBeNull();
    expect(await guard.run("gemini", async () => Promise.reject(new Error("boom")))).toBeNull();
    expect(await guard.run("gemini", async () => 42)).toBe(42);
  });

  it("treats SDK errors with status 429 as rate limits", async () => {
    const { guard } = setup();
    await guard.run("gemini", async () => {
      throw Object.assign(new Error("quota"), { status: 429 });
    });
    expect(await guard.run("gemini", async () => 1)).toBeNull();
    await guard.run("ollama", async () => {
      throw new RateLimitedError(5_000);
    });
    expect(await guard.acquire("ollama")).toBe(false);
  });

  it("keeps services independent", async () => {
    const { guard } = setup({ a: { perMinute: 1, perDay: 10 }, b: { perMinute: 1, perDay: 10 } });
    expect(await guard.acquire("a")).toBe(true);
    expect(await guard.acquire("a")).toBe(false);
    expect(await guard.acquire("b")).toBe(true);
  });
});

describe("QuotaGuard ledger", () => {
  it("records requests and 429s, and survives ledger failures", async () => {
    const calls: string[] = [];
    let fail = false;
    const ledger = {
      record: async (date: string, service: string, kind: string) => {
        if (fail) throw new Error("db down");
        calls.push(`${date} ${service} ${kind}`);
      },
    };
    const warnings: string[] = [];
    const guard = new QuotaGuard({
      ledger,
      now: () => Date.parse("2026-10-21T12:00:00Z"),
      warn: (m) => warnings.push(m),
      fetchImpl: (async () => new Response("", { status: 429 })) as unknown as typeof fetch,
    });
    await guard.fetch("news", "https://example.org");
    expect(calls).toEqual(["2026-10-21 news request", "2026-10-21 news 429"]);
    fail = true;
    await guard.acquire("tper");
    await new Promise((r) => setTimeout(r, 0));
    expect(warnings.some((w) => w.includes("ledger write failed"))).toBe(true);
  });

  it("seeds today's count so a fresh process respects the daily budget", async () => {
    const guard = new QuotaGuard({
      overrides: { svc: { perMinute: 100, perDay: 5 } },
      now: () => Date.parse("2026-10-21T12:00:00Z"),
      warn: () => {},
    });
    guard.seedDaily("svc", "2026-10-21", 5);
    expect(await guard.acquire("svc")).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 12:01:00 GMT", now)).toBe(60_000);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });
});
