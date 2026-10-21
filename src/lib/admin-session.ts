import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifySessionToken } from "./admin-auth";

// Server-only helper for admin pages and route handlers.
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(ADMIN_COOKIE)?.value, process.env.ADMIN_PASSWORD);
}
