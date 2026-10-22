import type { Env } from "@/lib/env";
import type { LlmProvider } from "@/lib/llm";
import type { WorkerConfig } from "@/lib/worker-config";
import type { SourceAdapter } from "./sources/types";

/** The configuration this worker runs with, as /admin should show it. No secrets. */
export function workerConfig(
  env: Env,
  provider: Pick<LlmProvider, "name">,
  adapters: Pick<SourceAdapter, "id" | "enabled">[],
  commit = process.env.GITHUB_SHA,
): WorkerConfig {
  const model = env.LLM_PROVIDER === "gemini" ? env.GEMINI_MODEL : env.LLM_PROVIDER === "ollama" ? env.OLLAMA_MODEL : undefined;
  const note =
    provider.name === env.LLM_PROVIDER
      ? undefined
      : env.LLM_PROVIDER === "gemini" && !env.GEMINI_API_KEY
        ? "GEMINI_API_KEY is empty"
        : `${env.LLM_PROVIDER} unavailable`;
  return {
    llmProvider: env.LLM_PROVIDER,
    extractor: provider.name,
    ...(model ? { model } : {}),
    ...(note ? { note } : {}),
    sources: Object.fromEntries(adapters.map((a) => [a.id, a.enabled(env)])),
    ...(commit ? { commit: commit.slice(0, 7) } : {}),
  };
}
