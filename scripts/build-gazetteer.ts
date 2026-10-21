// One-off build of src/lib/gazetteer/data/*.json from OpenStreetMap (Overpass) and the
// Comune di Bologna open data portal. The output is committed; runtime never calls these.
//
//   npm run gazetteer:build              # uses cached downloads in scripts/.cache if present
//   npm run gazetteer:build -- --refresh # re-download everything
//
// One batched Overpass query for everything, through the quota guard, with retries and
// mirror fallback (the public Overpass servers are often at capacity).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { GazetteerData, Geometry, Place, Position } from "../src/lib/gazetteer/types";
import { QuotaGuard } from "../src/lib/quota";
import { expandAliases } from "./gazetteer/aliases";
import { centroid, convexHull, lines, mainCluster, mergeLines, polygons, positionsOf, simplify, stitchRings } from "./gazetteer/geometry";
import { PLACES, type ComuneDataset, type PlaceSpec } from "./gazetteer/places";

const UA = "bologna-safety-map/0.1 (gazetteer build)";
const CACHE = "scripts/.cache";
const OUT = "src/lib/gazetteer/data";
// Checked 2026-10: overpass.private.coffee and overpass.kumi.systems time out.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const OPENDATA = "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets";
const COMUNE_FIELD: Record<ComuneDataset, string> = {
  "quartieri-di-bologna": "quartiere",
  "zone-del-comune-di-bologna": "nomezona",
  "aree-statistiche": "area_statistica",
};

const refresh = process.argv.includes("--refresh");
const guard = new QuotaGuard();

type LatLon = { lat: number; lon: number };
type OsmEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: (LatLon | null)[];
  members?: { type: string; role: string; lat?: number; lon?: number; geometry?: (LatLon | null)[] }[];
  tags?: Record<string, string>;
};
type FeatureCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, unknown>; geometry: Geometry | null }[];
};

// --- downloads ---------------------------------------------------------------------------

async function cached<T>(file: string, load: () => Promise<T>): Promise<T> {
  const path = `${CACHE}/${file}`;
  if (!refresh && existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
  const data = await load();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, JSON.stringify(data));
  return data;
}

async function withRetries<T>(label: string, attempt: (n: number) => Promise<T | null>): Promise<T> {
  for (let n = 0; n < 8; n++) {
    const out = await attempt(n);
    if (out !== null) return out;
    const wait = Math.min(120, 10 * 2 ** n);
    console.warn(`[build] ${label}: attempt ${n + 1} failed, retrying in ${wait}s`);
    await sleep(wait * 1000);
  }
  throw new Error(`${label}: giving up`);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, '\\"');

const osmNames = (match: (m: string) => boolean) => [
  ...new Set(PLACES.flatMap((p) => (p.source.kind === "osm" && match(p.source.match) ? p.source.names : []))),
];
const byName = (names: string[]) => `nwr["name"~"^(${names.map(esc).join("|")})$"](area.bo);`;

// Three smaller queries instead of one: the public servers time out on the big one.
const BATCHES: Record<string, string> = {
  streets: byName(osmNames((m) => m === "highway")),
  places: byName(osmNames((m) => m !== "highway")),
  "gates-motorways": `nwr["historic"="city_gate"](area.bo);
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"](area.bo);`,
};

const overpassQuery = (body: string) => `[out:json][timeout:180];
area["name"="Bologna"]["admin_level"="8"]["boundary"="administrative"]->.bo;
(
  ${body}
);
out geom;`;

async function fetchOverpass(): Promise<OsmEl[]> {
  const out: OsmEl[] = [];
  for (const [batch, body] of Object.entries(BATCHES)) {
    const els = await cached(`overpass-${batch}.json`, () =>
      withRetries(`overpass ${batch}`, async (n) => {
        const url = OVERPASS[n % OVERPASS.length];
        const res = await guard.fetch("overpass", url, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: overpassQuery(body) }),
          signal: AbortSignal.timeout(200_000),
        });
        if (!res?.ok) {
          if (res) console.warn(`[build] overpass ${batch}: HTTP ${res.status} from ${new URL(url).host}`);
          return null;
        }
        const json = (await res.json().catch(() => ({}))) as { elements?: OsmEl[]; remark?: string };
        if (json.remark) console.warn(`[build] overpass ${batch} remark: ${json.remark.slice(0, 200)}`);
        // An empty result means the query failed (or the mirror lacks the area): retry.
        return json.elements?.length ? json.elements : null;
      }),
    );
    console.log(`[build] overpass ${batch}: ${els.length} elements`);
    out.push(...els);
  }
  // A way can match more than one batch.
  return [...new Map(out.map((e) => [`${e.type}/${e.id}`, e])).values()];
}

function fetchComune(dataset: ComuneDataset): Promise<FeatureCollection> {
  return cached(`${dataset}.geojson`, () =>
    withRetries(dataset, async () => {
      const res = await guard.fetch("opendata", `${OPENDATA}/${dataset}/exports/geojson`, {
        headers: { "User-Agent": UA },
      });
      return res?.ok ? ((await res.json()) as FeatureCollection) : null;
    }),
  );
}

// --- OSM element -> geometry -------------------------------------------------------------

const pos = (p: LatLon): Position => [p.lon, p.lat];
const wayCoords = (g: (LatLon | null)[] = []) => g.filter((p): p is LatLon => !!p).map(pos);
const isClosed = (c: Position[]) => c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];

const TRANSIT = (t: Record<string, string>) =>
  t.highway === "bus_stop" || t.public_transport === "platform" || t.public_transport === "stop_position" ||
  t.amenity === "parking" || t.amenity === "parking_entrance" || t.railway === "platform";

const isLinearHighway = (e: OsmEl) =>
  e.type === "way" && !!e.tags?.highway && e.tags.area !== "yes" && !TRANSIT(e.tags) && !isClosedArea(e);

function isClosedArea(e: OsmEl): boolean {
  if (e.type !== "way") return false;
  const t = e.tags ?? {};
  const closed = isClosed(wayCoords(e.geometry));
  return closed && (t.area === "yes" || !!(t.place || t.leisure || t.landuse || t.amenity || t.building || t.tourism || t.man_made || t.aeroway));
}

function polygonOf(e: OsmEl): Position[][][] {
  if (isClosedArea(e)) return [[wayCoords(e.geometry)]];
  if (e.type === "relation" && (e.tags?.type === "multipolygon" || e.tags?.type === "boundary")) {
    const outer = stitchRings((e.members ?? []).filter((m) => m.role !== "inner" && m.type === "way").map((m) => wayCoords(m.geometry)));
    const inner = stitchRings((e.members ?? []).filter((m) => m.role === "inner").map((m) => wayCoords(m.geometry)));
    // Simplification: attach all holes to the first outer ring.
    return outer.map((ring, i) => (i === 0 ? [ring, ...inner] : [ring]));
  }
  return [];
}

function elPositions(e: OsmEl): Position[] {
  if (e.type === "node" && e.lat !== undefined) return [[e.lon!, e.lat]];
  if (e.type === "way") return wayCoords(e.geometry);
  return (e.members ?? []).flatMap((m) => (m.geometry ? wayCoords(m.geometry) : m.lat !== undefined ? [[m.lon!, m.lat] as Position] : []));
}

type Built = { geometry: Geometry; type: Place["type"] };

function fromOsm(spec: PlaceSpec, els: OsmEl[]): Built | null {
  if (spec.source.kind !== "osm") return null;
  const { names, match, where = {} } = spec.source;
  const named = els.filter(
    (e) =>
      e.tags?.name &&
      names.includes(e.tags.name) &&
      !TRANSIT(e.tags) &&
      Object.entries(where).every(([k, v]) => e.tags?.[k] === v),
  );

  if (match === "motorway") {
    const ways = els.filter(
      (e) =>
        e.type === "way" &&
        /^(motorway|trunk)(_link)?$/.test(e.tags?.highway ?? "") &&
        /tangenziale/i.test(`${e.tags?.name ?? ""} ${e.tags?.ref ?? ""} ${e.tags?.official_name ?? ""}`) &&
        !/bicicl/i.test(e.tags?.name ?? ""),
    );
    return ways.length ? { geometry: lines(mergeLines(ways.map((w) => wayCoords(w.geometry)))), type: "line" } : null;
  }

  if (match === "gate") {
    const gates = named.filter((e) => e.tags?.historic === "city_gate");
    const pick = gates.length ? gates : named; // fall back to the square around the gate
    return pick.length ? { geometry: { type: "Point", coordinates: centroid(pick.flatMap(elPositions)) }, type: "point" } : null;
  }

  if (!named.length) return null;

  if (match === "area") {
    const polys = named.flatMap(polygonOf).filter((p) => p.length);
    if (polys.length) return { geometry: polygons(polys), type: spec.type };
  }
  if (match === "highway" || match === "area") {
    const ls = named.filter(isLinearHighway).map((e) => wayCoords(e.geometry));
    if (ls.length) return { geometry: lines(mainCluster(mergeLines(ls))), type: "line" };
  }
  return { geometry: { type: "Point", coordinates: centroid(named.flatMap(elPositions)) }, type: "point" };
}

// "Porto - Saragozza" (Comune) == "Porto-Saragozza" (places.ts)
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s*-\s*/g, "-").trim();

function fromComune(spec: PlaceSpec, data: Record<ComuneDataset, FeatureCollection>): Built | null {
  if (spec.source.kind !== "comune") return null;
  const { dataset, value } = spec.source;
  const field = COMUNE_FIELD[dataset];
  const f = data[dataset].features.find((x) => norm(String(x.properties[field] ?? "")) === norm(value));
  if (!f?.geometry) return null;
  const g = f.geometry;
  if (g.type === "Polygon") return { geometry: polygons([g.coordinates]), type: "area" };
  if (g.type === "MultiPolygon") return { geometry: polygons(g.coordinates), type: "area" };
  return null;
}

// --- main --------------------------------------------------------------------------------

async function main() {
  const els = await fetchOverpass();
  console.log(`[build] overpass: ${els.length} elements`);
  const datasets = Object.keys(COMUNE_FIELD) as ComuneDataset[];
  const comune = Object.fromEntries(
    await Promise.all(datasets.map(async (d) => [d, await fetchComune(d)] as const)),
  ) as Record<ComuneDataset, FeatureCollection>;

  const built = new Map<string, Built & { source: Place["source"] }>();
  const missing: string[] = [];

  for (const spec of PLACES) {
    const b = spec.source.kind === "osm" ? fromOsm(spec, els) : spec.source.kind === "comune" ? fromComune(spec, comune) : null;
    if (b) built.set(spec.id, { ...b, source: spec.source.kind === "osm" ? "osm" : "comune" });
    else if (spec.source.kind === "osm" || spec.source.kind === "comune") missing.push(spec.id);
  }

  // Derived places depend on the ones above: unions first, then hulls (which may use unions).
  for (const kind of ["union", "hull"] as const) {
    for (const spec of PLACES) {
      if (spec.source.kind !== kind) continue;
      const parts = spec.source.of.map((id) => built.get(id)).filter((b) => !!b);
      if (parts.length < spec.source.of.length) {
        missing.push(`${spec.id} (needs ${spec.source.of.filter((id) => !built.has(id)).join(", ")})`);
        continue;
      }
      const geometry: Geometry =
        kind === "union"
          ? lines(parts.flatMap((p) => (p.geometry.type === "LineString" ? [p.geometry.coordinates] : p.geometry.type === "MultiLineString" ? p.geometry.coordinates : [])))
          : { type: "Polygon", coordinates: [simplify(convexHull(parts.flatMap((p) => positionsOf(p.geometry))))] };
      built.set(spec.id, { geometry, type: spec.type, source: "derived" });
    }
  }

  const places: Place[] = PLACES.filter((s) => built.has(s.id)).map((s) => {
    const b = built.get(s.id)!;
    return { id: s.id, name: s.name, type: b.type, aliases: expandAliases(s), geometry: b.geometry, source: b.source };
  });

  const out: GazetteerData = {
    generatedAt: new Date().toISOString(),
    attribution: [
      "© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright",
      "Comune di Bologna, Open Data (quartieri, zone, aree statistiche), CC BY 4.0 — https://opendata.comune.bologna.it",
    ],
    places,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/places.json`, JSON.stringify(out));

  // Official quartieri boundaries, kept as-is (simplified) for map overlays.
  const quartieri: FeatureCollection = {
    type: "FeatureCollection",
    features: comune["quartieri-di-bologna"].features.map((f) => ({
      type: "Feature",
      properties: { quartiere: f.properties.quartiere, cod_quar: f.properties.cod_quar },
      geometry: f.geometry && (fromComune({ id: "", name: "", type: "area", source: { kind: "comune", dataset: "quartieri-di-bologna", value: String(f.properties.quartiere) } }, comune)?.geometry ?? null),
    })),
  };
  writeFileSync(`${OUT}/quartieri.geojson`, JSON.stringify(quartieri));

  const byType = places.reduce<Record<string, number>>((acc, p) => ((acc[p.type] = (acc[p.type] ?? 0) + 1), acc), {});
  console.log(`[build] wrote ${places.length}/${PLACES.length} places`, byType);
  const downgraded = places.filter((p) => p.type !== PLACES.find((s) => s.id === p.id)!.type).map((p) => `${p.id}→${p.type}`);
  if (downgraded.length) console.log(`[build] geometry type differs from spec: ${downgraded.join(", ")}`);
  if (missing.length) {
    console.error(`[build] MISSING (${missing.length}): ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
