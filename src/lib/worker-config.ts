import { z } from "zod";

// What the worker reports about its own configuration on every run (source_status row
// "worker"), so /admin shows what the worker really uses. The website (Vercel) and the worker
// (GitHub Actions, or a machine) have separate environment variables.

export const WORKER_STATUS_ADAPTER = "worker";

export const workerConfigSchema = z.object({
  /** LLM_PROVIDER as configured for the worker. */
  llmProvider: z.string(),
  /** The extractor actually in use (rules when the configured one can't start). */
  extractor: z.string(),
  /** GEMINI_MODEL / OLLAMA_MODEL, when that provider is configured. */
  model: z.string().optional(),
  /** Why the extractor differs from the configured one. */
  note: z.string().optional(),
  /** Source id → enabled for this worker. */
  sources: z.record(z.string(), z.boolean()),
  /** Short commit the worker runs (GITHUB_SHA on Actions), if known. */
  commit: z.string().optional(),
});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

/** A worker report older than this is treated as missing (the worker is probably not running). */
export const WORKER_CONFIG_MAX_AGE_MS = 30 * 60_000;
