import { desc } from "drizzle-orm";
import { cellToBoundary } from "h3-js";
import { NextResponse, type NextRequest } from "next/server";
import { errInfo, logger } from "@/lib/log";
import { upcomingResponseSchema, type UpcomingResponse } from "@/lib/planned";
import { clientIp, RateLimiter, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(Number(process.env.CELLS_RATE_LIMIT_PER_MIN) || 60);
const MEMO_MS = 15_000;
let memo: { at: number; body: UpcomingResponse } | null = null;

// Upcoming announced protests from the latest snapshot (grouped and corroborated by the
// worker). Type, places, date/time and source counts only — no text, links or authors.
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
        .select({ generatedAt: cellsSnapshot.generatedAt, planned: cellsSnapshot.planned })
        .from(cellsSnapshot)
        .orderBy(desc(cellsSnapshot.generatedAt))
        .limit(1);
      // Whitelist + strict validation, as for /api/cells.
      const events = latest?.planned ?? [];
      memo = {
        at: Date.now(),
        body: upcomingResponseSchema.parse({
          generatedAt: latest?.generatedAt?.toISOString() ?? null,
          outline: {
            type: "FeatureCollection",
            features: events.flatMap((e) =>
              e.h3Cells.map((h3) => ({
                type: "Feature",
                properties: { h3, eventId: e.id },
                geometry: { type: "Polygon", coordinates: [cellToBoundary(h3, true)] },
              })),
            ),
          },
          events: events.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            startsAt: e.startsAt,
            timeKnown: e.timeKnown,
            locationNames: e.locationNames,
            h3Cells: e.h3Cells,
            sourceCount: e.sourceCount,
            officialSource: e.officialSource,
            counter: e.counter ?? false,
            recurring: e.recurring ?? false,
          })),
        }),
      };
    }
    return NextResponse.json(memo.body, {
      headers: { ...rateLimitHeaders(rl), "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60" },
    });
  } catch (err) {
    logger("api").error({ route: "/api/planned", ...errInfo(err) }, "request failed");
    return NextResponse.json({ error: "planned events unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
