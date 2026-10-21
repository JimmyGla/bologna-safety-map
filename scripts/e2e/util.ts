import type { Geometry, Position } from "../../src/lib/gazetteer/types";

export function centroidOf(g: Geometry): Position {
  const pts: Position[] =
    g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat(2) : g.coordinates.flat();
  const [x, y] = pts.reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
  return [x / pts.length, y / pts.length];
}
