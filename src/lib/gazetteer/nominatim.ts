import { z } from "zod";
import { BOLOGNA_BBOX } from "@/lib/geo";
import { getQuotaGuard, type QuotaGuard } from "@/lib/quota";
import { normalize } from "./normalize";
import type { Geometry, Position } from "./types";

// Fallback geocoder for place phrases the gazetteer doesn't know.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/): max 1 req/s
// (enforced by the quota guard), identifying User-Agent, results cached.
// Privacy (CLAUDE.md rule 1): pass a short place phrase only, never post text.

export type GeocodeResult = {
  name: string;
  geometry: Geometry;
  osmType: string;
  osmId: number;
};

export interface GeocodeCache {
  /** undefined = not cached; null = cached "no result". */
  get(key: string): Promise<GeocodeResult | null | undefined>;
  set(key: string, result: GeocodeResult | null): Promise<void>;
}

export type NominatimOptions = {
  cache: GeocodeCache;
  userAgent: string;
  guard?: QuotaGuard;
  endpoint?: string;
};

const MAX_QUERY_LENGTH = 120;
// place_rank below this is city/county level: too coarse to map to cells.
const MIN_PLACE_RANK = 16;

const resultSchema = z.object({
  osm_type: z.string(),
  osm_id: z.number(),
  lat: z.coerce.number(),
  lon: z.coerce.number(),
  name: z.string().optional(),
  display_name: z.string(),
  place_rank: z.number(),
  geojson: z.object({ type: z.string(), coordinates: z.unknown() }).optional(),
});

export function cacheKey(query: string): string {
  return normalize(query)
    .map((t) => (t.pre ? `${t.pre}:${t.t}` : t.t))
    .join(" ")
    .slice(0, MAX_QUERY_LENGTH);
}

const [WEST, SOUTH, EAST, NORTH] = BOLOGNA_BBOX;
const inBbox = ([lng, lat]: Position) => lng >= WEST && lng <= EAST && lat >= SOUTH && lat <= NORTH;

function toGeometry(r: z.infer<typeof resultSchema>): Geometry {
  const g = r.geojson;
  if (g && ["LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(g.type)) {
    return g as Geometry;
  }
  return { type: "Point", coordinates: [r.lon, r.lat] };
}

/** Geocodes a place phrase inside Bologna. Resolves null when unknown or unavailable. */
export async function nominatimGeocode(query: string, opts: NominatimOptions): Promise<GeocodeResult | null> {
  const key = cacheKey(query);
  if (!key) return null;
  const hit = await opts.cache.get(key);
  if (hit !== undefined) return hit;

  const url = new URL(opts.endpoint ?? "https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: `${query.slice(0, MAX_QUERY_LENGTH)}, Bologna`,
    format: "jsonv2",
    limit: "1",
    countrycodes: "it",
    viewbox: `${WEST},${NORTH},${EAST},${SOUTH}`,
    bounded: "1",
    polygon_geojson: "1",
    "accept-language": "it",
  }).toString();

  const res = await (opts.guard ?? getQuotaGuard()).fetch("nominatim", url, {
    headers: { "User-Agent": opts.userAgent, Accept: "application/json" },
  });
  // Skipped, rate-limited or failed: don't cache, try again another time.
  if (!res?.ok) return null;

  const parsed = z.array(resultSchema).safeParse(await res.json().catch(() => null));
  if (!parsed.success) return null;
  const r = parsed.data[0];
  const result: GeocodeResult | null =
    r && r.place_rank >= MIN_PLACE_RANK && inBbox([r.lon, r.lat])
      ? { name: r.name || r.display_name.split(",")[0], geometry: toGeometry(r), osmType: r.osm_type, osmId: r.osm_id }
      : null;
  await opts.cache.set(key, result);
  return result;
}

/** In-memory cache, for tests and one-off scripts. */
export class MemoryGeocodeCache implements GeocodeCache {
  private map = new Map<string, GeocodeResult | null>();
  async get(key: string) {
    return this.map.has(key) ? this.map.get(key)! : undefined;
  }
  async set(key: string, result: GeocodeResult | null) {
    this.map.set(key, result);
  }
}
