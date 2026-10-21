import { cellToBoundary } from "h3-js";
import type { ScoredCell } from "@/lib/scoring";
import { cellsResponseSchema, type CellFeature, type CellsResponse } from "./cells";

// Server-side: builds the /api/cells body (h3 polygons are computed here, not stored).

/**
 * Builds the /api/cells body from a snapshot. Copies only whitelisted fields and validates
 * the result, so a bad snapshot fails here instead of reaching clients.
 */
export function toCellsResponse(cells: ScoredCell[], generatedAt: Date | null, reducedAccuracy = false): CellsResponse {
  const features = cells.map((c): CellFeature => {
    // GeoJSON mode returns [lng, lat] pairs and already repeats the first point at the end.
    const ring = cellToBoundary(c.h3, true) as [number, number][];
    return {
      type: "Feature",
      id: c.h3,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        h3: c.h3,
        level: c.level,
        score: c.score,
        eventTypes: c.eventTypes,
        sourceCount: c.sourceCount,
        officialSource: c.officialSource,
        lastReportAt: c.lastReportAt,
        overridden: c.overridden,
      },
    };
  });
  return cellsResponseSchema.parse({
    type: "FeatureCollection",
    generatedAt: generatedAt?.toISOString() ?? null,
    reducedAccuracy,
    features,
  });
}
