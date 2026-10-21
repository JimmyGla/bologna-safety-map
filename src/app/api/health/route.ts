import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { computeHealth } from "@/lib/health";
import { errInfo, logger } from "@/lib/log";

export const dynamic = "force-dynamic";

// 200 for ok/degraded, 503 when the database is unreachable. For uptime monitors.
export async function GET() {
  let dbOk = false;
  let generatedAt: Date | null = null;
  let reducedAccuracy = false;
  try {
    const [{ db }, { cellsSnapshot }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    await db.execute(sql`select 1`);
    dbOk = true;
    const [latest] = await db
      .select({ generatedAt: cellsSnapshot.generatedAt, reducedAccuracy: cellsSnapshot.reducedAccuracy })
      .from(cellsSnapshot)
      .orderBy(desc(cellsSnapshot.generatedAt))
      .limit(1);
    generatedAt = latest?.generatedAt ?? null;
    reducedAccuracy = latest?.reducedAccuracy ?? false;
  } catch (err) {
    logger("api").warn({ route: "/api/health", ...errInfo(err) }, "health check failed");
  }
  const health = computeHealth({ dbOk, generatedAt, reducedAccuracy });
  return NextResponse.json(health, { status: health.status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
