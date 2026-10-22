import { GoogleGenAI } from "@google/genai";
import { logger } from "@/lib/log";
import { isTransient, type FailureDetail, type QuotaGuard } from "@/lib/quota";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { BATCH_JSON_SCHEMA, describeReport, parseBatchReport, type ExtractInput, type LlmProvider } from "./types";

// Google AI Studio free tier. Free-tier inputs may be used by Google to improve its
// products: only scrubbed item text is sent (no handles, no author data).
//
// When Google is overloaded (503 "high demand") or a quota is used up, a batch is:
//   1. retried once on the same model after RETRY_DELAY_MS (server errors only);
//   2. sent to GEMINI_FALLBACK_MODEL, which has its own free-tier quota;
//   3. reported as retryable, so the extraction job can keep the posts for the next run
//      instead of handing them to the keyword extractor (see extractAll / runExtraction).

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
export const RETRY_DELAY_MS = 3_000;
/** Quota-guard service of the fallback model (its own limits; QUOTA_LIMITS "gemini_lite=…"). */
export const FALLBACK_SERVICE = "gemini_lite";

export function createGeminiProvider(opts: {
  apiKey: string;
  model: string;
  /** Second model for overload/quota failures; undefined = none. */
  fallbackModel?: string;
  guard: QuotaGuard;
  now?: () => Date;
  client?: GeminiClient;
  sleep?: (ms: number) => Promise<void>;
}): LlmProvider {
  const client = opts.client ?? (new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as GeminiClient);
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastIssue: string | null = null;
  let retryable = false;

  // Logs say why a batch fell back to rules: counts, finish/block reasons, field names and
  // error codes. Never item text or what the model wrote.
  const problem = (issue: string, canRetry: boolean, fields: Record<string, unknown>) => {
    lastIssue = issue;
    retryable = canRetry;
    glog.warn({ model: opts.model, ...fields, issue, retryable: canRetry }, "gemini batch not fully usable");
  };

  const call = (model: string, service: string, items: ExtractInput[]) =>
    opts.guard.run(service, () =>
      client.models.generateContent({
        model,
        contents: userPrompt(items, now()),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema: BATCH_JSON_SCHEMA,
          temperature: 0,
        },
      }),
    );

  return {
    name: "gemini",
    maxBatch: GEMINI_BATCH,
    lastIssue: () => lastIssue,
    lastFailureRetryable: () => retryable,
    async extract(items: ExtractInput[]) {
      let res = await call(opts.model, "gemini", items);
      let failure: FailureDetail | undefined = res ? undefined : opts.guard.lastFailureDetail("gemini");
      let answeredBy = opts.model;

      // 1. A server error (503 overloaded, 500, …) often clears within seconds. Our own quota
      //    refusals and 429 backoffs would only be refused again, so they skip this step.
      if (!res && failure?.kind === "error" && isTransient(failure)) {
        await sleep(RETRY_DELAY_MS);
        res = await call(opts.model, "gemini", items);
        failure = res ? undefined : opts.guard.lastFailureDetail("gemini");
      }
      // 2. Still overloaded or out of quota: the fallback model has its own capacity and quota.
      if (!res && isTransient(failure) && opts.fallbackModel) {
        const first = failure!.reason;
        res = await call(opts.fallbackModel, FALLBACK_SERVICE, items);
        answeredBy = opts.fallbackModel;
        const second = res ? undefined : opts.guard.lastFailureDetail(FALLBACK_SERVICE);
        failure = second ? { ...second, reason: `${first}; ${opts.fallbackModel}: ${second.reason}` } : undefined;
      }
      if (!res) {
        problem(`call: ${failure?.reason ?? "skipped"}`, isTransient(failure), { items: items.length });
        return null;
      }
      if (answeredBy !== opts.model) glog.info({ model: answeredBy, items: items.length }, "answered by the fallback model");

      const finishReason = res.candidates?.[0]?.finishReason;
      const blockReason = res.promptFeedback?.blockReason;
      if (!res.text) {
        problem(`empty answer (${blockReason ? `blocked: ${blockReason}` : `finish: ${finishReason ?? "unknown"}`})`, false, {
          model: answeredBy,
          items: items.length,
          finishReason,
          blockReason,
        });
        return null;
      }
      const report = parseBatchReport(res.text, items.map((i) => i.id));
      const issue = describeReport(report, finishReason);
      if (issue) {
        problem(issue, false, {
          model: answeredBy,
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
        retryable = false;
      }
      return report.answers;
    },
  };
}
