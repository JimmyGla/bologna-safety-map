import { describe, expect, it, vi } from "vitest";
import { geocodePlace } from "@/lib/gazetteer";
import { MemoryGeocodeCache } from "@/lib/gazetteer/nominatim";
import { QuotaGuard } from "@/lib/quota";
import { MemoryIngestStore } from "@/worker/ingest/store";
import { DEFER_MAX_MS, runExtraction } from "@/worker/jobs/extract";
import { createGeminiProvider, RETRY_DELAY_MS, type GeminiClient } from "./gemini";
import { createRulesProvider, extractAll, geminiFallbackModel } from "./index";
import type { ExtractInput } from "./types";

// Gemini overloaded (503) or out of quota: retry, then the fallback model, then let posts wait
// for the next run (up to DEFER_MAX_MS) rather than reading them with keywords at once.

const NOW = new Date("2026-10-22T08:30:00Z");
const items: ExtractInput[] = [{ id: "1", text: "Scontri in piazza Verdi" }];
const answer = JSON.stringify({
  items: [
    {
      id: "1", relevant: true, event_type: "clashes", severity: 3, locations: ["piazza Verdi"], is_firsthand: false,
      time_reference: "now", confidence: 0.9, planned_start: "", planned_time_known: false, counter_protest: false,
    },
  ],
});
const overloaded = () =>
  Object.assign(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), {
    name: "ApiError",
    status: 503,
  });

/** A fake Gemini that answers each call from the script, per model. */
function setup(script: Record<string, (Error | "ok")[]>, overrides = {}) {
  const calls: string[] = [];
  const generateContent = vi.fn<GeminiClient["models"]["generateContent"]>(async ({ model }) => {
    calls.push(model);
    const next = script[model]?.shift() ?? "ok";
    if (next instanceof Error) throw next;
    return { text: answer, candidates: [{ finishReason: "STOP" }] };
  });
  const sleeps: number[] = [];
  const guard = new QuotaGuard({ warn: () => {}, overrides });
  const provider = createGeminiProvider({
    apiKey: "k",
    model: "flash",
    fallbackModel: "lite",
    guard,
    client: { models: { generateContent } },
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { provider, calls, sleeps, guard };
}

describe("gemini overload handling", () => {
  it("retries once after a short wait when the model is overloaded", async () => {
    const { provider, calls, sleeps } = setup({ flash: [overloaded()] });
    expect((await provider.extract(items))?.size).toBe(1);
    expect(calls).toEqual(["flash", "flash"]);
    expect(sleeps).toEqual([RETRY_DELAY_MS]);
  });

  it("uses the fallback model when the retry is overloaded too", async () => {
    const { provider, calls } = setup({ flash: [overloaded(), overloaded()] });
    expect((await provider.extract(items))?.size).toBe(1);
    expect(calls).toEqual(["flash", "flash", "lite"]);
    expect(provider.lastIssue!()).toBeNull();
  });

  it("goes straight to the fallback model when the main model's quota is used up", async () => {
    const { provider, calls } = setup({}, { gemini: { perMinute: 10, perDay: 0 } });
    expect((await provider.extract(items))?.size).toBe(1);
    expect(calls).toEqual(["lite"]);
  });

  it("reports a retryable failure when both models are overloaded", async () => {
    const { provider } = setup({ flash: [overloaded(), overloaded()], lite: [overloaded()] });
    expect(await provider.extract(items)).toBeNull();
    expect(provider.lastFailureRetryable!()).toBe(true);
    expect(provider.lastIssue!()).toMatch(/^call: call failed \(ApiError 503: .*high demand.*; lite: call failed \(ApiError 503/);
  });

  it("gives up at once on errors that won't fix themselves", async () => {
    const notFound = Object.assign(new Error("models/flash is not found"), { name: "ApiError", status: 404 });
    const { provider, calls, sleeps } = setup({ flash: [notFound] });
    expect(await provider.extract(items)).toBeNull();
    expect(calls).toEqual(["flash"]);
    expect(sleeps).toEqual([]);
    expect(provider.lastFailureRetryable!()).toBe(false);
  });

  it("can be switched off, and never falls back to the same model", () => {
    const env = (GEMINI_FALLBACK_MODEL: string) => ({ GEMINI_MODEL: "flash", GEMINI_FALLBACK_MODEL });
    expect(geminiFallbackModel(env("lite"))).toBe("lite");
    expect(geminiFallbackModel(env("none"))).toBeUndefined();
    expect(geminiFallbackModel(env("flash"))).toBeUndefined();
  });
});

describe("deferring items while the LLM is temporarily unavailable", () => {
  const down = () => setup({ flash: [overloaded(), overloaded()], lite: [overloaded()] }).provider;

  it("extractAll leaves out the items that may wait, and reads the others with rules", async () => {
    const two: ExtractInput[] = [...items, { id: "2", text: "Corteo in via Zamboni" }];
    const out = await extractAll(two, down(), createRulesProvider(), undefined, (id) => id === "1");
    expect(out.map((o) => [o.id, o.extractor])).toEqual([["2", "rules"]]);
  });

  it("does not defer when the failure is permanent", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "ApiError", status: 404 });
    const { provider } = setup({ flash: [notFound] });
    const out = await extractAll(items, provider, createRulesProvider(), undefined, () => true);
    expect(out.map((o) => o.extractor)).toEqual(["rules"]);
  });

  it("runExtraction keeps recent items for the next run and reads old ones with rules", async () => {
    let clock = new Date(NOW.getTime() - DEFER_MAX_MS - 60_000);
    const store = new MemoryIngestStore(() => clock);
    await store.insertRawItems([{ source: "news", feed: "carlino", externalId: "old", text: "Scontri in piazza Verdi, lanciati lacrimogeni" }]);
    clock = NOW;
    await store.insertRawItems([{ source: "news", feed: "carlino", externalId: "new", text: "Scontri in via Zamboni, cariche" }]);

    const offline = new QuotaGuard({ warn: () => {}, fetchImpl: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch });
    const summary = await runExtraction({
      store,
      provider: down(),
      rules: createRulesProvider(() => NOW),
      geocode: (p) => geocodePlace(p, { cache: new MemoryGeocodeCache(), userAgent: "test", guard: offline }),
      now: () => NOW,
    });

    expect(summary).toMatchObject({ items: 2, deferred: 1, byExtractor: { rules: 1 } });
    const left = await store.unprocessed(10);
    expect(left.map((i) => i.externalId)).toEqual(["new"]); // waits for Gemini next run
    expect(store.status.get("extract")?.details).toMatchObject({ deferred: 1, fallbacks: 1 });
  });
});
