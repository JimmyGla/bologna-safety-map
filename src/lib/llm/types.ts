import { z } from "zod";
import { EVENT_TYPES, type Extractor } from "@/db/schema";

// Common extraction output (CLAUDE.md "LLM"). Every provider returns this shape.

export const TIME_REFERENCES = ["now", "earlier_today", "old_or_unclear"] as const;

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
        },
        required: ["id", "relevant", "event_type", "severity", "locations", "is_firsthand", "time_reference", "confidence"],
      },
    },
  },
  required: ["items"],
} as const;

/** Parses a provider's JSON reply; invalid items are dropped (and later fall back to rules). */
export function parseBatchResponse(raw: string, ids: string[]): Map<string, Extraction> {
  const out = new Map<string, Extraction>();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return out;
  }
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return out;
  const wanted = new Set(ids);
  for (const it of items) {
    const parsed = extractionSchema.extend({ id: z.string() }).safeParse(it);
    if (!parsed.success || !wanted.has(parsed.data.id)) continue;
    const { id, ...ex } = parsed.data;
    out.set(id, ex.relevant ? ex : IRRELEVANT);
  }
  return out;
}
