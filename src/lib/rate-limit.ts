// Fixed-window, in-memory rate limiter (no external service). On Vercel each function
// instance keeps its own counters, so the effective limit is per IP *per instance*: a
// soft limit that stops a single client from hammering an instance, not a global quota.

export type RateLimitResult = { allowed: boolean; limit: number; remaining: number; resetMs: number };

export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(
    private limit: number,
    private windowMs = 60_000,
    private maxKeys = 50_000,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    const resetMs = w.start + this.windowMs - now;
    return { allowed: w.count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - w.count), resetMs };
  }

  /** Drops expired windows (and bounds memory if flooded with distinct keys). */
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs && this.windows.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    if (this.windows.size >= this.maxKeys) this.windows.clear();
  }
}

/** Client IP as seen behind Vercel's proxy (first x-forwarded-for hop), or "unknown". */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(Math.ceil(r.resetMs / 1000)),
  };
}
