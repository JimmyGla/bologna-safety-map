import { describe, expect, it } from "vitest";
import { QuotaGuard } from "@/lib/quota";
import { createGeminiProvider, type GeminiClient } from "./gemini";
import { extractAll } from "./index";
import { describeReport, parseBatchReport, type ExtractInput } from "./types";

// Why Gemini answers fall back to rules must be visible (logs, /admin) without any post text
// or model output leaking into the diagnosis.

const SECRET_TEXT = "Ragazza aggredita in via Irnerio";
const items: ExtractInput[] = [
  { id: "1", text: SECRET_TEXT },
  { id: "2", text: "Corteo in via Zamboni" },
];

const good = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  relevant: true,
  event_type: "march",
  severity: 1,
  locations: ["via Zamboni"],
  is_firsthand: false,
  time_reference: "now",
  confidence: 0.9,
  planned_start: "",
  planned_time_known: false,
  counter_protest: false,
  ...over,
});

function gemini(reply: Awaited<ReturnType<GeminiClient["models"]["generateContent"]>> | Error) {
  const guard = new QuotaGuard({ warn: () => {} });
  const client: GeminiClient = {
    models: {
      generateContent: async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
  return createGeminiProvider({ apiKey: "k", model: "gemini-test", guard, client });
}

describe("parseBatchReport", () => {
  it("names rejected fields and codes, never their values", () => {
    const raw = JSON.stringify({
      items: [good("1", { planned_start: "domani alle 15 in via Irnerio" }), good("2", { event_type: "riot" }), good("9")],
    });
    const r = parseBatchReport(raw, ["1", "2"]);
    expect(r).toMatchObject({ unreadable: null, invalid: 2, unknownIds: 1, missing: 2 });
    expect(r.fields).toEqual(["event_type:invalid_value", "planned_start:invalid_format"]);
    const summary = describeReport(r)!;
    expect(summary).toContain("2 of 2 items unusable");
    expect(summary).not.toMatch(/domani|Irnerio|riot/);
  });

  it("recognises unreadable answers and reports truncation", () => {
    expect(describeReport(parseBatchReport('{"items": [{"id": "1", "rel', ["1"]), "MAX_TOKENS")).toBe(
      "answer is not valid JSON (finish: MAX_TOKENS)",
    );
    expect(describeReport(parseBatchReport('{"results": []}', ["1"]))).toBe("answer has no items array");
  });

  it("returns null when every id got a valid answer", () => {
    expect(describeReport(parseBatchReport(JSON.stringify({ items: [good("1"), good("2")] }), ["1", "2"]))).toBeNull();
  });
});

describe("gemini provider diagnostics", () => {
  it("reports API errors with status and message", async () => {
    const err = Object.assign(new Error('{"error":{"code":404,"message":"models/gemini-test is not found"}}'), { name: "ApiError", status: 404 });
    const p = gemini(err);
    expect(await p.extract(items)).toBeNull();
    expect(p.lastIssue!()).toBe('call: call failed (ApiError 404: {"error":{"code":404,"message":"models/gemini-test is not found"}}), skipped');
  });

  it("reports blocked and empty answers", async () => {
    const blocked = gemini({ promptFeedback: { blockReason: "SAFETY" } });
    await blocked.extract(items);
    expect(blocked.lastIssue!()).toBe("empty answer (blocked: SAFETY)");
    const empty = gemini({ candidates: [{ finishReason: "MAX_TOKENS" }] });
    await empty.extract(items);
    expect(empty.lastIssue!()).toBe("empty answer (finish: MAX_TOKENS)");
  });

  it("clears the issue after a fully usable answer", async () => {
    const p = gemini({ text: JSON.stringify({ items: [good("1"), good("2")] }) });
    expect((await p.extract(items))?.size).toBe(2);
    expect(p.lastIssue!()).toBeNull();
  });

  it("passes each batch's issue to extractAll's callback, without post text", async () => {
    const p = gemini({ text: JSON.stringify({ items: [good("1", { severity: 9 })] }), candidates: [{ finishReason: "STOP" }] });
    const issues: string[] = [];
    const out = await extractAll(items, p, undefined, (i) => issues.push(i));
    expect(out.every((o) => o.extractor === "rules")).toBe(true);
    expect(issues).toEqual(["2 of 2 items unusable; 1 failed validation: severity:too_big"]);
    expect(issues.join(" ")).not.toContain("Irnerio");
  });
});
