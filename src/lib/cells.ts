import { z } from "zod";
import { EVENT_TYPES as EVENT_TYPE_IDS, type EventType } from "@/lib/event-types";

// Public shape of /api/cells. Aggregated per-area data only: `.strict()` rejects any extra
// property, on the server before sending and in the client, so no text, URL or author data
// can leak through (CLAUDE.md rule 1). Client-safe: no server or heavy imports.

export const EVENT_TYPES: Record<EventType, string> = {
  clashes: "Clashes",
  blockade: "Blockade",
  march: "March",
  police_presence: "Heavy police presence",
  aftermath: "Aftermath",
  peaceful_gathering: "Peaceful gathering",
  assault: "Assault",
  hate_attack: "Hate or squad attack",
  sexual_violence: "Sexual violence",
  vandalism: "Vandalism",
};

export const cellPropertiesSchema = z
  .object({
    h3: z.string().regex(/^[0-9a-f]{15}$/),
    level: z.number().int().min(0).max(4),
    score: z.number().min(0),
    eventTypes: z.array(z.enum(EVENT_TYPE_IDS)),
    /** Distinct independent sources (feeds). */
    sourceCount: z.number().int().min(0),
    /** At least one news, official or transit source. */
    officialSource: z.boolean(),
    lastReportAt: z.string().datetime().nullable(),
    /** Level set manually (cell_overrides). */
    overridden: z.boolean(),
  })
  .strict();

export const cellFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    id: z.string(),
    geometry: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
    }).strict(),
    properties: cellPropertiesSchema,
  })
  .strict();

export const cellsResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    // GeoJSON "foreign member": when the worker computed this snapshot (null: none yet).
    generatedAt: z.string().datetime().nullable(),
    /** Part of the data comes from the keyword fallback instead of an LLM. */
    reducedAccuracy: z.boolean(),
    features: z.array(cellFeatureSchema),
  })
  .strict();

export type CellProperties = z.infer<typeof cellPropertiesSchema>;
export type CellFeature = z.infer<typeof cellFeatureSchema>;
export type CellsResponse = z.infer<typeof cellsResponseSchema>;
