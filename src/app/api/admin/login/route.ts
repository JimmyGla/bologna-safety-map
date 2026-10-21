import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  SESSION_MS,
  adminConfigured,
  checkPassword,
  clearLoginFailures,
  createSessionToken,
  loginBlocked,
  recordLoginFailure,
} from "@/lib/admin-auth";
import { logger } from "@/lib/log";

const alog = logger("admin");

export async function POST(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  const client = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/login?${q}`, req.url), 303);

  if (!adminConfigured(password)) return back("error=disabled");
  if (loginBlocked(client)) return back("error=locked");

  const form = await req.formData().catch(() => null);
  const input = String(form?.get("password") ?? "");
  if (!(await checkPassword(input, password))) {
    recordLoginFailure(client);
    alog.warn("admin login failed");
    await new Promise((r) => setTimeout(r, 750)); // slow down guessing
    return back("error=invalid");
  }

  clearLoginFailures(client);
  const res = NextResponse.redirect(new URL("/admin", req.url), 303);
  res.cookies.set(ADMIN_COOKIE, await createSessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  alog.info("admin login");
  return res;
}
