import { POLYGON_TO_CELLS_FLAGS, polygonToCells, polygonToCellsExperimental } from "h3-js";
import { H3_RESOLUTION } from "@/lib/geo";
import type { Geometry, Position } from "./types";

export const POINT_BUFFER_M = 100;
export const LINE_BUFFER_M = 75;

const M_PER_DEG_LAT = 111_132;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Cells touched by a closed ring (any overlap, not just cell centers). */
function overlapping(ring: Position[], res: number): string[] {
  return polygonToCellsExperimental([ring], res, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true);
}

function circle([lng, lat]: Position, radiusM: number, steps = 16): Position[] {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / mPerDegLng(lat);
  const ring: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return [...ring, ring[0]];
}

/** Rectangle of half-width `radiusM` around segment a-b (null if a == b). */
function segmentBox(a: Position, b: Position, radiusM: number): Position[] | null {
  const kx = mPerDegLng((a[1] + b[1]) / 2);
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return null;
  // Unit normal in meters, converted back to degrees.
  const nx = ((-dy / len) * radiusM) / kx;
  const ny = ((dx / len) * radiusM) / M_PER_DEG_LAT;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
    [a[0] + nx, a[1] + ny],
  ];
}

function lineCells(line: Position[], res: number, out: Set<string>) {
  for (let i = 0; i < line.length; i++) {
    // Round caps at every vertex keep corners covered; boxes cover the segments.
    for (const c of overlapping(circle(line[i], LINE_BUFFER_M, 8), res)) out.add(c);
    if (i === 0) continue;
    const box = segmentBox(line[i - 1], line[i], LINE_BUFFER_M);
    if (box) for (const c of overlapping(box, res)) out.add(c);
  }
}

function polygonCells(rings: Position[][], res: number, out: Set<string>) {
  let cells = polygonToCells(rings, res, true);
  // A small square can miss every cell center; fall back to "touches".
  if (cells.length === 0) cells = overlapping(rings[0], res);
  for (const c of cells) out.add(c);
}

/**
 * H3 cells (default res 9) covering a geometry: points buffered 100 m, lines 75 m,
 * polygons by polyfill (cell centers inside).
 */
export function toCells(geometry: Geometry, res = H3_RESOLUTION): string[] {
  const out = new Set<string>();
  switch (geometry.type) {
    case "Point":
      for (const c of overlapping(circle(geometry.coordinates, POINT_BUFFER_M), res)) out.add(c);
      break;
    case "LineString":
      lineCells(geometry.coordinates, res, out);
      break;
    case "MultiLineString":
      for (const l of geometry.coordinates) lineCells(l, res, out);
      break;
    case "Polygon":
      polygonCells(geometry.coordinates, res, out);
      break;
    case "MultiPolygon":
      for (const p of geometry.coordinates) polygonCells(p, res, out);
      break;
  }
  return [...out].sort();
}
