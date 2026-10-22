import { z } from "zod";
import { EVENT_TYPES, type Extractor } from "@/db/schema";

// Common extraction output (CLAUDE.md "LLM"). Every provider returns this shape.

export const TIME_REFERENCES = ["now", "earlier_today", "planned", "old_or_unclear"] as const;

export const extractionSchema = z.object({
  relevant: z.boolean(),
  // Providers answer "none" (portable across JSON-schema dialects); stored as null.
  event_type: z.preprocess((v) => (v === "none" ? null : v), z.enum(EVENT_TYPES).nullable()),
  severity: z.number().int().min(0).max(3),
  /** Place names exactly as written in the text (resolved later by the gazetteer). */
  locations: z.array(z.string().max(120)).max(10),
  is_firsthand: z.boolean(),
  time_reference: z.enum(TIME_REFERENCES),
  confidence: z.number().min(0).max(1),
  /** For time_reference "planned": ISO 8601 start with offset; "" / null otherwise. */
  planned_start: z.preprocess((v) => (v === "" || v === "none" ? null : v), z.string().datetime({ offset: true }).nullable()).default(null),
  /** false when only the day of a planned event is known. */
  planned_time_known: z.boolean().default(false),
  /** Announced in opposition to another event (contromanifestazione): raises forecast risk. */
  counter_protest: z.boolean().default(false),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const batchResponseSchema = z.object({
  items: z.array(extractionSchema.extend({ id: z.string() })),
});

export type ExtractInput = {
  id: string;
  text: string;
  publishedAt?: Date;
};

export interface LlmProvider {
  name: Extractor;
  /** Largest batch the provider takes per request. */
  maxBatch: number;
  /**
   * Extractions keyed by input id. Items missing from the result (or a null result on
   * quota/errors) fall back to the rules extractor.
   */
  extract(items: ExtractInput[]): Promise<Map<string, Extraction> | null>;
  /** Why the most recent batch wasn't fully answered (for /admin); null if it was. */
  lastIssue?(): string | null;
  /**
   * The most recent batch failed for a reason that should pass soon (overload, quota, network):
   * its items may wait for the next run instead of going to the rules extractor.
   */
  lastFailureRetryable?(): boolean;
}

/** The answer for anything irrelevant. */
export const IRRELEVANT: Extraction = {
  relevant: false,
  event_type: null,
  severity: 0,
  locations: [],
  is_firsthand: false,
  time_reference: "old_or_unclear",
  confidence: 0,
  planned_start: null,
  planned_time_known: false,
  counter_protest: false,
};

/** JSON Schema of the batch response, for Gemini (responseJsonSchema) and Ollama (format). */
export const BATCH_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          event_type: { type: "string", enum: [...EVENT_TYPES, "none"] },
          severity: { type: "integer", minimum: 0, maximum: 3 },
          locations: { type: "array", items: { type: "string" } },
          is_firsthand: { type: "boolean" },
          time_reference: { type: "string", enum: [...TIME_REFERENCES] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          planned_start: { type: "string" },
          planned_time_known: { type: "boolean" },
          counter_protest: { type: "boolean" },
        },
        required: ["id", "relevant", "event_type", "severity", "locations", "is_firsthand", "time_reference", "confidence", "planned_start", "planned_time_known", "counter_protest"],
      },
    },
  },
  required: ["items"],
} as const;

/** What happened to a provider's reply. Field names and error codes only — never values. */
export type ParseReport = {
  answers: Map<string, Extraction>;
  /** The reply wasn't JSON, or had no "items" array. */
  unreadable: "invalid_json" | "no_items" | null;
  /** Items in the reply that failed validation. */
  invalid: number;
  /** Valid items whose id wasn't asked for. */
  unknownIds: number;
  /** Ids asked for that got no valid answer. */
  missing: number;
  /** "field:code" of validation failures, e.g. "planned_start:invalid_format" (max 10). */
  fields: string[];
};

const itemSchema = extractionSchema.extend({ id: z.string() });

/** Parses a provider's JSON reply and reports what it had to drop (dropped items fall back to rules). */
export function parseBatchReport(raw: string, ids: string[]): ParseReport {
  const report: ParseReport = { answers: new Map(), unreadable: null, invalid: 0, unknownIds: 0, missing: ids.length, fields: [] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    report.unreadable = "invalid_json";
    return report;
  }
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) {
    report.unreadable = "no_items";
    return report;
  }
  const wanted = new Set(ids);
  const fields = new Set<string>();
  for (const it of items) {
    const parsed = itemSchema.safeParse(it);
    if (!parsed.success) {
      report.invalid++;
      // Path segments that are names (not array indexes) + the issue code. No values or messages:
      // they could quote what the model wrote.
      for (const issue of parsed.error.issues) {
        const path = issue.path.filter((p) => typeof p === "string").join(".") || "(item)";
        fields.add(`${path}:${issue.code}`);
      }
      continue;
    }
    if (!wanted.has(parsed.data.id)) {
      report.unknownIds++;
      continue;
    }
    const { id, ...ex } = parsed.data;
    report.answers.set(id, ex.relevant ? ex : IRRELEVANT);
  }
  report.missing = ids.filter((id) => !report.answers.has(id)).length;
  report.fields = [...fields].sort().slice(0, 10);
  return report;
}

/** One-line summary of what went wrong, or null if every id got a valid answer. */
export function describeReport(r: ParseReport, finishReason?: string): string | null {
  const finish = finishReason && finishReason !== "STOP" ? ` (finish: ${finishReason})` : "";
  if (r.unreadable) return `${r.unreadable === "invalid_json" ? "answer is not valid JSON" : "answer has no items array"}${finish}`;
  if (!r.missing) return null;
  const parts = [`${r.missing} of ${r.missing + r.answers.size} items unusable`];
  if (r.invalid) parts.push(`${r.invalid} failed validation: ${r.fields.join(", ")}`);
  if (r.unknownIds) parts.push(`${r.unknownIds} with unknown ids`);
  return parts.join("; ") + finish;
}

/** Parses a provider's JSON reply; invalid items are dropped (and later fall back to rules). */
export function parseBatchResponse(raw: string, ids: string[]): Map<string, Extraction> {
  return parseBatchReport(raw, ids).answers;
}
