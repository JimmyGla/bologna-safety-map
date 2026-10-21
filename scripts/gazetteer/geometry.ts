// Geometry helpers for the gazetteer build (not used at runtime).
import type { Geometry, Position } from "../../src/lib/gazetteer/types";

export const round = ([x, y]: Position): Position => [+x.toFixed(6), +y.toFixed(6)];

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** Douglas-Peucker in degrees (tolerance ~0.00004 ≈ 4 m at Bologna's latitude). */
export function simplify(line: Position[], tolerance = 0.00004): Position[] {
  if (line.length <= 2) return line.map(round);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(line[i], line[a], line[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]).map(round);
}

function segDist(p: Position, a: Position, b: Position): number {
  const kx = Math.cos((p[1] * Math.PI) / 180);
  const [px, py, ax, ay, bx, by] = [p[0] * kx, p[1], a[0] * kx, a[1], b[0] * kx, b[1]];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Joins line pieces that share endpoints (OSM splits streets into many ways). */
export function mergeLines(lines: Position[][]): Position[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const out: Position[][] = [];
  while (pool.length) {
    let line = pool.pop()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i];
        const [s, e, os, oe] = [line[0], line[line.length - 1], o[0], o[o.length - 1]];
        let joined: Position[] | null = null;
        if (same(e, os)) joined = [...line, ...o.slice(1)];
        else if (same(e, oe)) joined = [...line, ...o.slice(0, -1).reverse()];
        else if (same(s, oe)) joined = [...o, ...line.slice(1)];
        else if (same(s, os)) joined = [...o.slice(1).reverse(), ...line];
        if (joined) {
          line = joined;
          pool.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    out.push(line);
  }
  return out;
}

const metersBetween = (a: Position, b: Position) =>
  Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 111_132);

const lengthOf = (l: Position[]) => l.slice(1).reduce((sum, p, i) => sum + metersBetween(l[i], p), 0);

/**
 * Keeps the largest group of lines lying within `maxGapM` of each other. Drops stray ways
 * of a different street with the same name elsewhere in the comune (e.g. a second
 * "Via Galliera" 6 km north of the real one).
 */
export function mainCluster(ls: Position[][], maxGapM = 400): Position[][] {
  if (ls.length <= 1) return ls;
  const parent = ls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      if (find(i) === find(j)) continue;
      if (ls[i].some((a) => ls[j].some((b) => metersBetween(a, b) < maxGapM))) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Position[][]>();
  ls.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));
  const total = (g: Position[][]) => g.reduce((s, l) => s + lengthOf(l), 0);
  return [...groups.values()].sort((a, b) => total(b) - total(a))[0];
}

/** Stitches multipolygon member ways into closed rings. Unclosable pieces are dropped. */
export function stitchRings(pieces: Position[][]): Position[][] {
  return mergeLines(pieces).filter((r) => r.length >= 4 && same(r[0], r[r.length - 1]));
}

/** Monotone-chain convex hull. */
export function convexHull(points: Position[]): Position[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Position, a: Position, b: Position) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Position[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Position[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return [...hull, hull[0]];
}

export function positionsOf(g: Geometry): Position[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates];
    case "LineString":
      return g.coordinates;
    case "MultiLineString":
    case "Polygon":
      return g.coordinates.flat();
    case "MultiPolygon":
      return g.coordinates.flat(2);
  }
}

export function centroid(points: Position[]): Position {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Position, [0, 0] as Position);
  return round([sum[0] / points.length, sum[1] / points.length]);
}

export function lines(ls: Position[][]): Geometry {
  const s = ls.map((l) => simplify(l));
  return s.length === 1 ? { type: "LineString", coordinates: s[0] } : { type: "MultiLineString", coordinates: s };
}

export function polygons(polys: Position[][][]): Geometry {
  const s = polys.map((rings) => rings.map((r) => simplify(r)));
  return s.length === 1 ? { type: "Polygon", coordinates: s[0] } : { type: "MultiPolygon", coordinates: s };
}
