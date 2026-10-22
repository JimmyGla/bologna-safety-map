import { desc } from "drizzle-orm";
import { cellToBoundary } from "h3-js";
import { NextResponse, type NextRequest } from "next/server";
import { blockKey, forecastResponseSchema, type Forecast, type ForecastResponse } from "@/lib/forecast";
import { errInfo, logger } from "@/lib/log";
import { clientIp, RateLimiter, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(Number(process.env.CELLS_RATE_LIMIT_PER_MIN) || 60);
const MEMO_MS = 15_000;
let memo: { at: number; body: ForecastResponse } | null = null;

/** Whitelisted copy of the stored forecast (no other fields can pass, even if stored). */
function publicForecast(f: Forecast): Forecast {
  return {
    generatedAt: f.generatedAt,
    blocks: f.blocks.map((b) => ({ start: b.start, end: b.end })),
    cells: f.cells.map((c) => ({ h3: c.h3, levels: c.levels, eventIds: c.eventIds, counter: c.counter, recentIncidents: c.recentIncidents })),
  };
}

// Expected-risk forecast for the next 72h from the latest snapshot (computed by the worker).
// Aggregated per-cell data only: levels per 6-hour block, event ids, counts.
export async function GET(req: NextRequest) {
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { ...rateLimitHeaders(rl), "Retry-After": String(Math.ceil(rl.resetMs / 1000)), "Cache-Control": "no-store" } },
    );
  }
  try {
    if (!memo || Date.now() - memo.at > MEMO_MS) {
      const [{ db }, { cellsSnapshot }] = await Promise.all([import("@/db"), import("@/db/schema")]);
      const [latest] = await db
        .select({ forecast: cellsSnapshot.forecast })
        .from(cellsSnapshot)
        .orderBy(desc(cellsSnapshot.generatedAt))
        .limit(1);
      const forecast = latest?.forecast ? publicForecast(latest.forecast) : null;
      memo = {
        at: Date.now(),
        body: forecastResponseSchema.parse({
          forecast,
          geojson: {
            type: "FeatureCollection",
            features: (forecast?.cells ?? []).map((c) => ({
              type: "Feature",
              // One numeric property per block, so the map can switch blocks with a style expression.
              properties: { h3: c.h3, ...Object.fromEntries(c.levels.map((l, i) => [blockKey(i), l])) },
              geometry: { type: "Polygon", coordinates: [cellToBoundary(c.h3, true)] },
            })),
          },
        }),
      };
    }
    return NextResponse.json(memo.body, {
      headers: { ...rateLimitHeaders(rl), "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60" },
    });
  } catch (err) {
    logger("api").error({ route: "/api/forecast", ...errInfo(err) }, "request failed");
    return NextResponse.json({ error: "forecast unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
