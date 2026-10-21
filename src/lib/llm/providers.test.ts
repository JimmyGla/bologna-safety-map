import { describe, expect, it, vi } from "vitest";
import { QuotaGuard } from "@/lib/quota";
import { FIXTURES } from "./fixtures";
import { createGeminiProvider, type GeminiClient } from "./gemini";
import { extractAll } from "./index";
import { createOllamaProvider } from "./ollama";
import { SYSTEM_PROMPT } from "./prompt";
import { createRulesProvider } from "./rules";
import { BATCH_JSON_SCHEMA, type ExtractInput } from "./types";

const NOW = new Date("2026-10-21T12:00:00Z");
const inputs: ExtractInput[] = FIXTURES.map((f, i) => ({ id: String(i), text: f.text }));

const answer = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  relevant: true,
  event_type: "march",
  severity: 1,
  locations: ["piazza Verdi"],
  is_firsthand: false,
  time_reference: "now",
  confidence: 0.9,
  ...over,
});

const quietGuard = (overrides = {}) => new QuotaGuard({ overrides, warn: () => {}, now: () => NOW.getTime(), sleep: async () => {} });

function fakeGemini(reply: (ids: string[]) => unknown) {
  const generateContent = vi.fn(async (params: { contents: string }) => {
    const ids = [...params.contents.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    const r = reply(ids);
    if (r instanceof Error) throw r;
    return { text: typeof r === "string" ? r : JSON.stringify(r) };
  });
  return { client: { models: { generateContent } } as unknown as GeminiClient, generateContent };
}

describe("gemini provider", () => {
  it("sends batches of ≤20 with the system prompt and JSON schema", async () => {
    const { client, generateContent } = fakeGemini((ids) => ({ items: ids.map((id) => answer(id)) }));
    const provider = createGeminiProvider({ apiKey: "k", model: "gemini-test", guard: quietGuard(), client, now: () => NOW });
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, text: `corteo ${i}` }));
    const out = await extractAll(many, provider, createRulesProvider(() => NOW));

    expect(generateContent).toHaveBeenCalledTimes(2);
    const [first] = generateContent.mock.calls[0] as unknown as [{ model: string; config: Record<string, unknown> }];
    expect(first.model).toBe("gemini-test");
    expect(first.config).toMatchObject({
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: BATCH_JSON_SCHEMA,
    });
    expect(out.every((o) => o.extractor === "gemini")).toBe(true);
  });

  it("maps 'none' to null and normalizes irrelevant answers", async () => {
    const { client } = fakeGemini((ids) => ({ items: ids.map((id) => answer(id, { relevant: false, event_type: "none", locations: ["x"] })) }));
    const provider = createGeminiProvider({ apiKey: "k", model: "m", guard: quietGuard(), client });
    const [r] = await extractAll(inputs.slice(0, 1), provider);
    expect(r.extraction).toMatchObject({ relevant: false, event_type: null, locations: [] });
  });

  it("falls back to rules for items it skipped or answered invalidly", async () => {
    const { client } = fakeGemini((ids) => ({
      items: [answer(ids[0]), answer(ids[1], { severity: 7 })], // second is invalid, the rest missing
    }));
    const provider = createGeminiProvider({ apiKey: "k", model: "m", guard: quietGuard(), client });
    const out = await extractAll(inputs.slice(0, 4), provider, createRulesProvider(() => NOW));
    expect(out.map((o) => o.extractor)).toEqual(["gemini", "rules", "rules", "rules"]);
  });

  it("falls back to rules on 429 and pauses further calls", async () => {
    const { client, generateContent } = fakeGemini(() => Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 }));
    const provider = createGeminiProvider({ apiKey: "k", model: "m", guard: quietGuard(), client });
    const first = await extractAll(inputs.slice(0, 2), provider, createRulesProvider(() => NOW));
    const second = await extractAll(inputs.slice(2, 4), provider, createRulesProvider(() => NOW));
    expect([...first, ...second].every((o) => o.extractor === "rules")).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not call the API once the daily quota is used", async () => {
    const { client, generateContent } = fakeGemini((ids) => ({ items: ids.map((id) => answer(id)) }));
    const provider = createGeminiProvider({ apiKey: "k", model: "m", guard: quietGuard({ gemini: { perMinute: 10, perDay: 1 } }), client });
    await extractAll(inputs.slice(0, 1), provider);
    const out = await extractAll(inputs.slice(1, 2), provider);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out[0].extractor).toBe("rules");
  });

  it("survives non-JSON output", async () => {
    const { client } = fakeGemini(() => "Sorry, I can't help with that.");
    const provider = createGeminiProvider({ apiKey: "k", model: "m", guard: quietGuard(), client });
    const out = await extractAll(inputs.slice(0, 2), provider, createRulesProvider(() => NOW));
    expect(out.map((o) => o.extractor)).toEqual(["rules", "rules"]);
  });
});

describe("ollama provider", () => {
  function setup(reply: (body: { model: string; messages: { role: string; content: string }[] }) => Response) {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => reply(JSON.parse(String(init?.body))));
    const guard = new QuotaGuard({ warn: () => {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    return { fetchImpl, provider: createOllamaProvider({ baseUrl: "http://localhost:11434", model: "qwen2.5:7b", guard, now: () => NOW }) };
  }

  it("posts the shared prompt and schema to /api/chat in batches of 5", async () => {
    const { fetchImpl, provider } = setup((body) => {
      const ids = [...body.messages[1].content.matchAll(/"id":"(\d+)"/g)].map((m) => m[1]);
      return Response.json({ message: { content: JSON.stringify({ items: ids.map((id) => answer(id)) }) } });
    });
    const out = await extractAll(inputs.slice(0, 7), provider);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "qwen2.5:7b", stream: false, format: BATCH_JSON_SCHEMA });
    expect(body.messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(out.every((o) => o.extractor === "ollama")).toBe(true);
  });

  it("falls back to rules when Ollama is not running", async () => {
    const { provider } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const out = await extractAll(inputs.slice(0, 3), provider, createRulesProvider(() => NOW));
    expect(out.every((o) => o.extractor === "rules")).toBe(true);
  });
});

describe("prompt", () => {
  it("covers the rules the extractors must follow", () => {
    for (const needle of ["IN BOLOGNA", "another city", "anni fa", "sarcasm", "Never output personal names", "3 = clashes"]) {
      expect(SYSTEM_PROMPT).toContain(needle);
    }
  });
});
