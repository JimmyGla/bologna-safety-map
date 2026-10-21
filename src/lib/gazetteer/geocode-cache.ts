import { eq } from "drizzle-orm";
import { db } from "@/db";
import { geocodeCache } from "@/db/schema";
import type { GeocodeCache, GeocodeResult } from "./nominatim";

// Server-only. Hits are kept 30 days, misses 7 (new OSM data may fill them in).
const HIT_TTL_MS = 30 * 86_400_000;
const MISS_TTL_MS = 7 * 86_400_000;

export class DbGeocodeCache implements GeocodeCache {
  async get(key: string): Promise<GeocodeResult | null | undefined> {
    const [row] = await db.select().from(geocodeCache).where(eq(geocodeCache.query, key)).limit(1);
    if (!row) return undefined;
    const ttl = row.result ? HIT_TTL_MS : MISS_TTL_MS;
    return Date.now() - row.createdAt.getTime() > ttl ? undefined : row.result;
  }

  async set(key: string, result: GeocodeResult | null): Promise<void> {
    await db
      .insert(geocodeCache)
      .values({ query: key, result, createdAt: new Date() })
      .onConflictDoUpdate({ target: geocodeCache.query, set: { result, createdAt: new Date() } });
  }
}
