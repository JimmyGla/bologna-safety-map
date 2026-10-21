import type { QuotaGuard } from "@/lib/quota";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { BATCH_JSON_SCHEMA, parseBatchResponse, type ExtractInput, type LlmProvider } from "./types";

// Local model via Ollama's HTTP API, with structured output (format = JSON schema).
// Small local models do better with short batches.
export const OLLAMA_BATCH = 5;
const TIMEOUT_MS = 180_000; // CPU inference can be slow

export function createOllamaProvider(opts: {
  baseUrl: string;
  model: string;
  guard: QuotaGuard;
  now?: () => Date;
}): LlmProvider {
  const now = opts.now ?? (() => new Date());
  return {
    name: "ollama",
    maxBatch: OLLAMA_BATCH,
    async extract(items: ExtractInput[]) {
      const res = await opts.guard.fetch("ollama", new URL("/api/chat", opts.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          stream: false,
          format: BATCH_JSON_SCHEMA,
          options: { temperature: 0 },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt(items, now()) },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res?.ok) return null;
      const body = (await res.json().catch(() => null)) as { message?: { content?: string } } | null;
      const content = body?.message?.content;
      return content ? parseBatchResponse(content, items.map((i) => i.id)) : null;
    },
  };
}
