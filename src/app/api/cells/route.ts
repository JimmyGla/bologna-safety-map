import { desc } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import type { CellsResponse } from "@/lib/cells";
import { toCellsResponse } from "@/lib/cells-response";
import { errInfo, logger } from "@/lib/log";
import { clientIp, RateLimiter, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(Number(process.env.CELLS_RATE_LIMIT_PER_MIN) || 60);

// The worker writes a snapshot every minute and the CDN caches responses for 30s. This
// in-process cache also covers requests that miss the CDN (e.g. junk query strings), so
// they don't each cost a database query.
const MEMO_MS = 15_000;
let memo: { at: number; body: CellsResponse } | null = null;

// Serves the latest cells_snapshot written by the worker (every minute).
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
      // Imported here so a missing DATABASE_URL fails the request, not the build.
      const [{ db }, { cellsSnapshot }] = await Promise.all([import("@/db"), import("@/db/schema")]);
      const [latest] = await db
        .select({ generatedAt: cellsSnapshot.generatedAt, cells: cellsSnapshot.cells, reducedAccuracy: cellsSnapshot.reducedAccuracy })
        .from(cellsSnapshot)
        .orderBy(desc(cellsSnapshot.generatedAt))
        .limit(1);
      memo = { at: Date.now(), body: toCellsResponse(latest?.cells ?? [], latest?.generatedAt ?? null, latest?.reducedAccuracy ?? false) };
    }
    return NextResponse.json(memo.body, {
      headers: { ...rateLimitHeaders(rl), "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=30" },
    });
  } catch (err) {
    logger("api").error({ route: "/api/cells", ...errInfo(err) }, "request failed");
    return NextResponse.json({ error: "cells unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
