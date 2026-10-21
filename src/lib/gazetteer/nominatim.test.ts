import { describe, expect, it, vi } from "vitest";
import { QuotaGuard } from "@/lib/quota";
import { MemoryGeocodeCache, cacheKey, nominatimGeocode } from "./nominatim";

const HIT = {
  osm_type: "way",
  osm_id: 123,
  lat: "44.4986",
  lon: "11.3561",
  name: "Via Filippo Re",
  display_name: "Via Filippo Re, Irnerio, Bologna",
  place_rank: 26,
  geojson: { type: "LineString", coordinates: [[11.355, 44.498], [11.357, 44.499]] },
};

function setup(responses: Response[]) {
  let t = 0;
  const sleeps: number[] = [];
  const fetchImpl = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
    async () => responses.shift() ?? Response.json([]),
  );
  const guard = new QuotaGuard({
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    warn: () => {},
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const cache = new MemoryGeocodeCache();
  const opts = { cache, guard, userAgent: "bologna-safety-map/test" };
  return { fetchImpl, sleeps, cache, opts };
}

describe("nominatimGeocode", () => {
  it("sends a bounded Bologna query with a User-Agent and returns the geometry", async () => {
    const { fetchImpl, opts } = setup([Response.json([HIT])]);
    const r = await nominatimGeocode("via Filippo Re", opts);
    expect(r).toEqual({ name: "Via Filippo Re", geometry: HIT.geojson, osmType: "way", osmId: 123 });

    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(String(url));
    expect(u.hostname).toBe("nominatim.openstreetmap.org");
    expect(u.searchParams.get("bounded")).toBe("1");
    expect(u.searchParams.get("viewbox")).toBe("11.22,44.56,11.43,44.42");
    expect(u.searchParams.get("q")).toBe("via Filippo Re, Bologna");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("bologna-safety-map/test");
  });

  it("serves repeats from the cache, including misses", async () => {
    const { fetchImpl, opts } = setup([Response.json([HIT]), Response.json([])]);
    await nominatimGeocode("Via Filippo Re", opts);
    await nominatimGeocode("via filippo re", opts);
    expect(await nominatimGeocode("posto inesistente", opts)).toBeNull();
    expect(await nominatimGeocode("posto inesistente", opts)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waits 1 s between requests", async () => {
    const { sleeps, opts } = setup([Response.json([HIT]), Response.json([HIT])]);
    await nominatimGeocode("via a", opts);
    await nominatimGeocode("via b", opts);
    expect(sleeps).toEqual([1_000]);
  });

  it("rejects results outside Bologna or too coarse (city level)", async () => {
    const { opts } = setup([
      Response.json([{ ...HIT, lat: "45.46", lon: "9.19" }]),
      Response.json([{ ...HIT, place_rank: 12 }]),
    ]);
    expect(await nominatimGeocode("via milano", opts)).toBeNull();
    expect(await nominatimGeocode("bologna", opts)).toBeNull();
  });

  it("falls back to a point when there is no usable geojson", async () => {
    const { opts } = setup([Response.json([{ ...HIT, geojson: undefined }])]);
    expect((await nominatimGeocode("via x", opts))?.geometry).toEqual({ type: "Point", coordinates: [11.3561, 44.4986] });
  });

  it("degrades gracefully on 429 / server errors and does not cache them", async () => {
    const { cache, opts } = setup([new Response("", { status: 429 }), new Response("", { status: 503 })]);
    expect(await nominatimGeocode("via y", opts)).toBeNull();
    expect(await cache.get(cacheKey("via y"))).toBeUndefined();
  });
});
