import { GoogleGenAI } from "@google/genai";
import { logger } from "@/lib/log";
import type { QuotaGuard } from "@/lib/quota";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { BATCH_JSON_SCHEMA, describeReport, parseBatchReport, type ExtractInput, type LlmProvider } from "./types";

// Google AI Studio free tier. Free-tier inputs may be used by Google to improve its
// products: only scrubbed item text is sent (no handles, no author data).

const glog = logger("gemini");

/** The part of the SDK we use, so tests can pass a fake. */
export type GeminiClient = {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{
      text?: string;
      candidates?: { finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    }>;
  };
};

export const GEMINI_BATCH = 20; // items per request, to save quota

export function createGeminiProvider(opts: {
  apiKey: string;
  model: string;
  guard: QuotaGuard;
  now?: () => Date;
  client?: GeminiClient;
}): LlmProvider {
  const client = opts.client ?? (new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as GeminiClient);
  const now = opts.now ?? (() => new Date());
  let lastIssue: string | null = null;

  // Logs say why a batch fell back to rules: counts, finish/block reasons, field names and
  // error codes. Never item text or what the model wrote.
  const problem = (issue: string, fields: Record<string, unknown>) => {
    lastIssue = issue;
    glog.warn({ model: opts.model, ...fields, issue }, "gemini batch not fully usable; falling back to rules");
  };

  return {
    name: "gemini",
    maxBatch: GEMINI_BATCH,
    lastIssue: () => lastIssue,
    async extract(items: ExtractInput[]) {
      const res = await opts.guard.run("gemini", () =>
        client.models.generateContent({
          model: opts.model,
          contents: userPrompt(items, now()),
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseJsonSchema: BATCH_JSON_SCHEMA,
            temperature: 0,
          },
        }),
      );
      if (!res) {
        problem(`call: ${opts.guard.lastFailure("gemini") ?? "skipped"}`, { items: items.length });
        return null;
      }
      const finishReason = res.candidates?.[0]?.finishReason;
      const blockReason = res.promptFeedback?.blockReason;
      if (!res.text) {
        problem(`empty answer (${blockReason ? `blocked: ${blockReason}` : `finish: ${finishReason ?? "unknown"}`})`, {
          items: items.length,
          finishReason,
          blockReason,
        });
        return null;
      }
      const report = parseBatchReport(res.text, items.map((i) => i.id));
      const issue = describeReport(report, finishReason);
      if (issue) {
        problem(issue, {
          items: items.length,
          answered: report.answers.size,
          invalid: report.invalid,
          missing: report.missing,
          unknownIds: report.unknownIds,
          fields: report.fields,
          unreadable: report.unreadable,
          finishReason,
          answerLength: res.text.length,
        });
      } else {
        lastIssue = null;
      }
      return report.answers;
    },
  };
}
