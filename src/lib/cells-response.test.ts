import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { cellsResponseSchema } from "./cells";
import { toCellsResponse } from "./cells-response";
import { scoreCells } from "./scoring";

const NOW = new Date("2026-10-21T12:00:00Z");
const A = latLngToCell(44.4967, 11.35, 9);

describe("toCellsResponse", () => {
  const cells = scoreCells(
    [{ eventType: "march", credibility: 0.85, confidence: 0.8, occurredAt: NOW, h3Cells: [A], sourceFeed: "news:carlino", sourceClass: "news" }],
    [],
    NOW,
  );

  it("builds a valid FeatureCollection with generatedAt and closed hexagons", () => {
    const body = toCellsResponse(cells, NOW);
    expect(body.generatedAt).toBe(NOW.toISOString());
    const [f] = body.features;
    expect(f.properties).toEqual({
      h3: A,
      level: 1, // 0.5 × 0.85 × 0.8 = 0.34 < 0.4
      score: 0.34,
      eventTypes: ["march"],
      sourceCount: 1,
      officialSource: true,
      lastReportAt: NOW.toISOString(),
      overridden: false,
    });
    const ring = f.geometry.coordinates[0];
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
  });

  it("returns an empty collection before the first snapshot", () => {
    expect(toCellsResponse([], null)).toEqual({ type: "FeatureCollection", generatedAt: null, reducedAccuracy: false, features: [] });
  });

  it("contains no text, URLs or author data, even if a snapshot did", () => {
    const tainted = cells.map((c) => ({ ...c, text: "Corteo, foto di u/someone", url: "https://reddit.com/x", author: "someone" }));
    const json = JSON.stringify(toCellsResponse(tainted, NOW));
    expect(json).not.toMatch(/someone|reddit|Corteo|https?:/);
  });

  it("is rejected by the schema if a forbidden field sneaks in", () => {
    const body = toCellsResponse(cells, NOW);
    (body.features[0].properties as Record<string, unknown>).username = "x";
    expect(() => cellsResponseSchema.parse(body)).toThrow();
  });
});
