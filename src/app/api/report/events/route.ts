import { NextResponse, type NextRequest } from "next/server";
import { errInfo, logger } from "@/lib/log";
import { clientIp, RateLimiter, rateLimitHeaders } from "@/lib/rate-limit";
import { toCsv } from "@/lib/report/aggregate";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(10);
const MAX_DAYS = 365;

// CSV of the anonymous archive: one row per event. Type, severity, source category, time and
// area only; attacks on people and sexual violence by quartiere and day, without cells.
export async function GET(req: NextRequest) {
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { ...rateLimitHeaders(rl), "Cache-Control": "no-store" } });
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 90));
  try {
    const { archivedEventsSince } = await import("@/lib/report/data");
    const rows = await archivedEventsSince(days);
    const csv = toCsv(
      ["period_start_utc", "precision", "event_type", "severity", "source_class", "extractor", "quartieri", "h3_cells"],
      rows.map((r) => [r.period.toISOString(), r.precision, r.eventType, r.severity, r.sourceClass, r.extractor, r.quartieri.join("|"), r.h3Cells.join("|")]),
    );
    return new NextResponse(csv, {
      headers: {
        ...rateLimitHeaders(rl),
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bologna-safety-map-events-${days}d.csv"`,
        "Cache-Control": "public, max-age=600, s-maxage=600",
      },
    });
  } catch (err) {
    logger("api").error({ route: "/api/report/events", ...errInfo(err) }, "request failed");
    return NextResponse.json({ error: "export unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
