import { NextResponse, type NextRequest } from "next/server";
import { errInfo, logger } from "@/lib/log";
import { clientIp, RateLimiter, rateLimitHeaders } from "@/lib/rate-limit";
import { toCsv } from "@/lib/report/aggregate";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(10);
const MAX_DAYS = 90;

// CSV of what the map showed: the highest danger level of each map cell in each UTC hour
// (cells at level 0 are not stored).
export async function GET(req: NextRequest) {
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { ...rateLimitHeaders(rl), "Cache-Control": "no-store" } });
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  try {
    const { archivedLevelsSince } = await import("@/lib/report/data");
    const rows = await archivedLevelsSince(days);
    const csv = toCsv(["hour_start_utc", "h3", "max_level"], rows.map((r) => [r.hour.toISOString(), r.h3, r.maxLevel]));
    return new NextResponse(csv, {
      headers: {
        ...rateLimitHeaders(rl),
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bologna-safety-map-levels-${days}d.csv"`,
        "Cache-Control": "public, max-age=600, s-maxage=600",
      },
    });
  } catch (err) {
    logger("api").error({ route: "/api/report/levels", ...errInfo(err) }, "request failed");
    return NextResponse.json({ error: "export unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
