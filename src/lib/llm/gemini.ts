import { GoogleGenAI } from "@google/genai";
import type { QuotaGuard } from "@/lib/quota";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { BATCH_JSON_SCHEMA, parseBatchResponse, type ExtractInput, type LlmProvider } from "./types";

// Google AI Studio free tier. Free-tier inputs may be used by Google to improve its
// products: only scrubbed item text is sent (no handles, no author data).

/** The part of the SDK we use, so tests can pass a fake. */
export type GeminiClient = {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{ text?: string }>;
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
  return {
    name: "gemini",
    maxBatch: GEMINI_BATCH,
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
      if (!res?.text) return null;
      return parseBatchResponse(res.text, items.map((i) => i.id));
    },
  };
}
