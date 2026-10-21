import type { Extractor } from "@/db/schema";
import type { Env } from "@/lib/env";
import type { QuotaGuard } from "@/lib/quota";
import { createGeminiProvider } from "./gemini";
import { createOllamaProvider } from "./ollama";
import { createRulesProvider } from "./rules";
import type { Extraction, ExtractInput, LlmProvider } from "./types";
import { errInfo, logger } from "@/lib/log";

const llog = logger("llm");

export type { Extraction, ExtractInput, LlmProvider } from "./types";
export { createRulesProvider } from "./rules";

/** The provider LLM_PROVIDER asks for, or "rules" when it isn't configured. */
export function createProvider(env: Env, guard: QuotaGuard, now: () => Date = () => new Date()): LlmProvider {
  if (env.LLM_PROVIDER === "gemini") {
    if (env.GEMINI_API_KEY) return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, guard, now });
    llog.warn("LLM_PROVIDER=gemini but GEMINI_API_KEY is empty; using rules");
  }
  if (env.LLM_PROVIDER === "ollama") {
    return createOllamaProvider({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL, guard, now });
  }
  return createRulesProvider(now);
}

export type ExtractedItem = { id: string; extraction: Extraction; extractor: Extractor };

/**
 * Runs `provider` in batches; any batch it can't answer (quota, error, invalid JSON) and any
 * item missing from its answer falls back to `rules`. Never throws.
 */
export async function extractAll(
  items: ExtractInput[],
  provider: LlmProvider,
  rules: LlmProvider = createRulesProvider(),
): Promise<ExtractedItem[]> {
  const out: ExtractedItem[] = [];
  const step = Number.isFinite(provider.maxBatch) ? provider.maxBatch : items.length || 1;
  let fallbacks = 0;

  for (let i = 0; i < items.length; i += step) {
    const batch = items.slice(i, i + step);
    let answered: Map<string, Extraction> | null = null;
    if (provider.name !== "rules") {
      try {
        answered = await provider.extract(batch);
      } catch (err) {
        llog.warn({ provider: provider.name, ...errInfo(err) }, "provider failed; falling back to rules");
      }
    }
    const missing = batch.filter((it) => !answered?.has(it.id));
    const ruled = missing.length ? await rules.extract(missing) : null;
    if (provider.name !== "rules") fallbacks += missing.length;

    for (const it of batch) {
      const fromProvider = answered?.get(it.id);
      out.push(
        fromProvider
          ? { id: it.id, extraction: fromProvider, extractor: provider.name }
          : { id: it.id, extraction: ruled!.get(it.id)!, extractor: "rules" },
      );
    }
  }
  if (fallbacks) llog.warn({ provider: provider.name, fallbacks, items: items.length }, "items extracted with rules (fallback)");
  return out;
}
