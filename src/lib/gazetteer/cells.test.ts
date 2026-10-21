import { cellToLatLng, getResolution, gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { toCells } from "./cells";

const NETTUNO: [number, number] = [11.3426, 44.4943];

describe("toCells", () => {
  it("buffers a point by 100 m: its own cell plus neighbours within reach", () => {
    const cells = toCells({ type: "Point", coordinates: NETTUNO });
    const own = latLngToCell(NETTUNO[1], NETTUNO[0], 9);
    expect(cells).toContain(own);
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells.length).toBeLessThanOrEqual(7);
    // Never further than the first ring for a 100 m buffer (res 9 edge ≈ 200 m).
    const ring1 = new Set(gridDisk(own, 1));
    expect(cells.every((c) => ring1.has(c))).toBe(true);
    expect(cells.every((c) => getResolution(c) === 9)).toBe(true);
  });

  it("buffers a line by 75 m along its whole length", () => {
    // ~1.1 km east-west line.
    const line: [number, number][] = [
      [11.335, 44.4949],
      [11.349, 44.4949],
    ];
    const cells = toCells({ type: "LineString", coordinates: line });
    for (const lng of [11.335, 11.338, 11.342, 11.346, 11.349]) {
      expect(cells).toContain(latLngToCell(44.4949, lng, 9));
    }
    // Nothing more than ~75 m + one cell away from the line.
    for (const c of cells) expect(Math.abs(cellToLatLng(c)[0] - 44.4949)).toBeLessThan(0.004);
  });

  it("handles MultiLineString like separate lines", () => {
    const a: [number, number][] = [[11.33, 44.49], [11.331, 44.49]];
    const b: [number, number][] = [[11.36, 44.51], [11.361, 44.51]];
    const both = toCells({ type: "MultiLineString", coordinates: [a, b] });
    expect(both).toEqual(
      [...new Set([...toCells({ type: "LineString", coordinates: a }), ...toCells({ type: "LineString", coordinates: b })])].sort(),
    );
  });

  it("polyfills polygons by cell centre", () => {
    const square: [number, number][] = [
      [11.33, 44.49], [11.35, 44.49], [11.35, 44.50], [11.33, 44.50], [11.33, 44.49],
    ];
    const cells = toCells({ type: "Polygon", coordinates: [square] });
    expect(cells.length).toBeGreaterThan(10);
    for (const c of cells) {
      const [lat, lng] = cellToLatLng(c);
      expect(lat >= 44.49 && lat <= 44.5 && lng >= 11.33 && lng <= 11.35).toBe(true);
    }
  });

  it("falls back to overlapping cells for a polygon smaller than a cell", () => {
    const tiny: [number, number][] = [
      [11.3425, 44.4942], [11.3427, 44.4942], [11.3427, 44.4944], [11.3425, 44.4944], [11.3425, 44.4942],
    ];
    expect(toCells({ type: "Polygon", coordinates: [tiny] })).toEqual([latLngToCell(44.4943, 11.3426, 9)]);
  });
});
