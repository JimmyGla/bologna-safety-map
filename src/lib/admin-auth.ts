// Admin session: "<expiresAtMs>.<hmac>" in an httpOnly cookie, signed with ADMIN_PASSWORD
// (changing the password logs everyone out). Web Crypto only, so it runs anywhere.

export const ADMIN_COOKIE = "bsm_admin";
export const SESSION_MS = 12 * 3_600_000;
export const MIN_PASSWORD_LENGTH = 12;

const enc = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return Buffer.from(sig).toString("hex");
}

/** Constant-time string comparison (both sides are hex digests of equal length). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Admin is available only with a long enough ADMIN_PASSWORD. */
export function adminConfigured(password: string | undefined): password is string {
  return !!password && password.length >= MIN_PASSWORD_LENGTH;
}

export async function checkPassword(input: string, password: string): Promise<boolean> {
  // Compare digests, not raw strings, so timing doesn't leak length or prefix.
  const [a, b] = await Promise.all([hmacHex("bsm-login", input), hmacHex("bsm-login", password)]);
  return safeEqual(a, b);
}

export async function createSessionToken(password: string, now = Date.now()): Promise<string> {
  const exp = now + SESSION_MS;
  return `${exp}.${await hmacHex(password, `admin-session:${exp}`)}`;
}

export async function verifySessionToken(token: string | undefined, password: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !adminConfigured(password)) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= now || !sig) return false;
  return safeEqual(sig, await hmacHex(password, `admin-session:${exp}`));
}

// Login throttling: 5 failures per client per 15 minutes. In-memory: fine for a single
// instance; on serverless it resets per instance (the delay below still applies).
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; since: number }>();

export function loginBlocked(client: string, now = Date.now()): boolean {
  const f = failures.get(client);
  if (!f || now - f.since > WINDOW_MS) return false;
  return f.count >= MAX_FAILURES;
}

export function recordLoginFailure(client: string, now = Date.now()) {
  const f = failures.get(client);
  if (!f || now - f.since > WINDOW_MS) failures.set(client, { count: 1, since: now });
  else f.count++;
}

export function clearLoginFailures(client: string) {
  failures.delete(client);
}
