import pino from "pino";

// Structured JSON logs (server/worker only). Silent in tests unless LOG_LEVEL is set.
// Redaction is a backstop for CLAUDE.md rule 1: item text, URLs and author data must not
// be logged at all, and are removed if a call ever passes them.
export const REDACT_PATHS = ["text", "*.text", "url", "*.url", "authorMeta", "*.authorMeta", "author", "*.author", "handle", "*.handle"];

export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { app: "bologna-safety-map" },
  redact: { paths: REDACT_PATHS, remove: true },
});

export const logger = (module: string) => log.child({ module });

/**
 * Error message safe to log or store. Drizzle's query errors embed the SQL and its
 * parameters ("Failed query: insert into raw_items … params: <post text>"), so for those
 * only the database's own reason is kept. Truncated to 300 characters.
 */
export function safeErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; cause?: { message?: unknown; code?: unknown } } | null;
  let msg = String(e?.message ?? err);
  if (/^Failed query:/i.test(msg)) {
    const code = e?.cause?.code ? ` (${String(e.cause.code)})` : "";
    msg = `query failed${code}${e?.cause?.message ? `: ${String(e.cause.message)}` : ""}`;
  }
  return msg.replace(/\bparams:[\s\S]*$/i, "").trim().slice(0, 300);
}

/** Error fields worth logging (no stack, no query parameters, message truncated). */
export const errInfo = (err: unknown) => ({
  err: { name: (err as Error)?.name ?? "Error", message: safeErrorMessage(err) },
});

/** "Name: message" for status rows (source_status.last_error). */
export const errSummary = (err: unknown) => `${(err as Error)?.name ?? "Error"}: ${safeErrorMessage(err)}`;
