import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { overrideDeleteSchema, overrideInputSchema } from "@/lib/admin/overrides";
import { isAdmin } from "@/lib/admin-session";
import { errInfo, logger } from "@/lib/log";

export const dynamic = "force-dynamic";
const alog = logger("admin");

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

// Upserts a manual level for a cell. The worker applies it on its next scoring pass (≤1 min).
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const parsed = overrideInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const { h3, level, reason, expiresInMinutes } = parsed.data;
  try {
    const [{ db }, { cellOverrides }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
    await db
      .insert(cellOverrides)
      .values({ h3, level, reason, expiresAt })
      .onConflictDoUpdate({ target: cellOverrides.h3, set: { level, reason, expiresAt, createdAt: new Date() } });
    alog.info({ h3, level, expiresInMinutes }, "override set");
    return NextResponse.json({ ok: true, h3, level, expiresAt });
  } catch (err) {
    alog.error(errInfo(err), "override failed");
    return NextResponse.json({ error: "database error" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const parsed = overrideDeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "h3 required" }, { status: 400 });
  try {
    const [{ db }, { cellOverrides }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    await db.delete(cellOverrides).where(eq(cellOverrides.h3, parsed.data.h3));
    alog.info({ h3: parsed.data.h3 }, "override removed");
    return NextResponse.json({ ok: true });
  } catch (err) {
    alog.error(errInfo(err), "override delete failed");
    return NextResponse.json({ error: "database error" }, { status: 503 });
  }
}
