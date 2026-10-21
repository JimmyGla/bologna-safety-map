import { parseQuotaLimits, type QuotaOverrides } from "@/lib/env";
import { logger } from "@/lib/log";

const qlog = logger("quota");

// Quota guard (CLAUDE.md rule 5). Every external call goes through here.
// Refused, rate-limited or failed calls resolve to null — callers skip that source.
// Per-minute counters are in-memory; daily counters are also written to an optional
// QuotaLedger (the quota_ledger table in the worker) and seeded from it on start, so
// short-lived runs (worker:once) share one daily budget.

export type QuotaLimit = {
  perMinute: number;
  perDay: number;
  /** Minimum spacing between calls; callers wait (not refused) for their slot. */
  minIntervalMs?: number;
};

// Conservative free-tier defaults. Check each provider's current terms before raising.
export const DEFAULT_LIMITS: Record<string, QuotaLimit> = {
  nominatim: { perMinute: 60, perDay: 2_000, minIntervalMs: 1_000 }, // policy: max 1 req/s
  overpass: { perMinute: 4, perDay: 200, minIntervalMs: 5_000 },
  opendata: { perMinute: 10, perDay: 200, minIntervalMs: 1_000 }, // Comune di Bologna portal
  gemini: { perMinute: 10, perDay: 250 },
  ollama: { perMinute: 120, perDay: 50_000 },
  news: { perMinute: 30, perDay: 2_000 },
  tper: { perMinute: 6, perDay: 500 },
  bluesky: { perMinute: 30, perDay: 3_000 },
  mastodon: { perMinute: 30, perDay: 3_000 },
  // Unauthenticated RSS: Reddit answered 429 to a 2nd request within a minute.
  reddit: { perMinute: 1, perDay: 300, minIntervalMs: 60_000 },
  telegram: { perMinute: 6, perDay: 1_000, minIntervalMs: 2_000 }, // t.me/s/ web previews
  // MTProto API (user session). Telegram answers floods with FLOOD_WAIT: keep it slow.
  telegram_api: { perMinute: 20, perDay: 3_000, minIntervalMs: 1_500 },
};

const FALLBACK_LIMIT: QuotaLimit = { perMinute: 10, perDay: 500 };
const MAX_BACKOFF_MS = 15 * 60_000;

type ServiceState = {
  minute: number[]; // timestamps of calls in the last 60s
  day: string; // UTC date of `dayCount`
  dayCount: number;
  pausedUntil: number;
  consecutive429: number;
  nextSlotAt: number;
};

/** Durable daily counters. Writes are fire-and-forget; failures only warn. */
export interface QuotaLedger {
  record(date: string, service: string, kind: "request" | "429"): Promise<void>;
}

export type QuotaGuardOptions = {
  overrides?: QuotaOverrides;
  ledger?: QuotaLedger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  warn?: (msg: string) => void;
  fetchImpl?: typeof fetch;
};

export class RateLimitedError extends Error {
  constructor(public retryAfterMs?: number) {
    super("rate limited");
  }
}

export class QuotaGuard {
  private state = new Map<string, ServiceState>();
  private limits: Record<string, QuotaLimit>;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private warn: (msg: string) => void;
  private fetchImpl: typeof fetch;
  private ledger?: QuotaLedger;

  constructor(opts: QuotaGuardOptions = {}) {
    this.ledger = opts.ledger;
    this.limits = { ...DEFAULT_LIMITS };
    for (const [service, o] of Object.entries(opts.overrides ?? {})) {
      this.limits[service] = { ...this.limits[service], ...o };
    }
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.warn = opts.warn ?? ((msg) => qlog.warn(msg));
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  limitFor(service: string): QuotaLimit {
    return this.limits[service] ?? FALLBACK_LIMIT;
  }

  private stateFor(service: string): ServiceState {
    let s = this.state.get(service);
    if (!s) {
      s = { minute: [], day: "", dayCount: 0, pausedUntil: 0, consecutive429: 0, nextSlotAt: 0 };
      this.state.set(service, s);
    }
    return s;
  }

  /** Seeds today's count from the ledger (e.g. at worker start). Keeps the higher value. */
  seedDaily(service: string, date: string, requests: number) {
    const s = this.stateFor(service);
    if (s.day !== date) {
      s.day = date;
      s.dayCount = 0;
    }
    s.dayCount = Math.max(s.dayCount, requests);
  }

  private persist(service: string, kind: "request" | "429") {
    if (!this.ledger) return;
    const date = new Date(this.now()).toISOString().slice(0, 10);
    this.ledger.record(date, service, kind).catch((err: Error) => {
      this.warn(`ledger write failed (${err.name}); counting in memory only`);
    });
  }

  /** Reserves a call slot. Resolves false (and warns) when the call must be skipped. */
  async acquire(service: string): Promise<boolean> {
    const limit = this.limitFor(service);
    const s = this.stateFor(service);
    let now = this.now();

    if (s.pausedUntil > now) {
      this.warn(`${service}: backing off for ${Math.ceil((s.pausedUntil - now) / 1000)}s, skipped`);
      return false;
    }
    const today = new Date(now).toISOString().slice(0, 10);
    if (s.day !== today) {
      s.day = today;
      s.dayCount = 0;
    }
    if (s.dayCount >= limit.perDay) {
      this.warn(`${service}: daily quota (${limit.perDay}) reached, skipped`);
      return false;
    }
    s.minute = s.minute.filter((t) => now - t < 60_000);
    if (s.minute.length >= limit.perMinute) {
      this.warn(`${service}: per-minute quota (${limit.perMinute}) reached, skipped`);
      return false;
    }

    // Count the call up front so concurrent callers can't overshoot.
    s.dayCount++;
    s.minute.push(now);
    this.persist(service, "request");
    if (limit.minIntervalMs) {
      const slot = Math.max(now, s.nextSlotAt);
      s.nextSlotAt = slot + limit.minIntervalMs;
      if (slot > now) {
        await this.sleep(slot - now);
        now = this.now();
      }
    }
    return true;
  }

  /** Records a 429 and pauses the service (Retry-After, else exponential backoff). */
  rateLimited(service: string, retryAfterMs?: number) {
    const s = this.stateFor(service);
    s.consecutive429++;
    const backoff = retryAfterMs ?? Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** s.consecutive429);
    s.pausedUntil = this.now() + backoff;
    this.persist(service, "429");
    this.warn(`${service}: HTTP 429, pausing ${Math.ceil(backoff / 1000)}s`);
  }

  private succeeded(service: string) {
    this.stateFor(service).consecutive429 = 0;
  }

  /**
   * fetch() through the guard. Returns null when skipped, rate-limited (429) or on a
   * network error; any other response (including non-2xx) is returned to the caller.
   */
  async fetch(service: string, url: string | URL, init?: RequestInit): Promise<Response | null> {
    if (!(await this.acquire(service))) return null;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(30_000), ...init });
    } catch (err) {
      // undici puts the real reason (DNS, TLS, refused, timeout) in `cause`.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const why = cause?.code ?? cause?.message ?? (err as Error).message;
      this.warn(`${service}: request failed (${(err as Error).name}: ${String(why).slice(0, 120)}), skipped`);
      return null;
    }
    if (res.status === 429) {
      this.rateLimited(service, parseRetryAfter(res.headers.get("retry-after"), this.now()));
      return null;
    }
    this.succeeded(service);
    return res;
  }

  /**
   * Runs an SDK call through the guard. Errors (including 429s, detected from
   * `status`/`code` or a thrown RateLimitedError) are swallowed and resolve to null.
   */
  async run<T>(service: string, fn: () => Promise<T>): Promise<T | null> {
    if (!(await this.acquire(service))) return null;
    try {
      const out = await fn();
      this.succeeded(service);
      return out;
    } catch (err) {
      if (isRateLimit(err)) {
        this.rateLimited(service, err instanceof RateLimitedError ? err.retryAfterMs : undefined);
      } else {
        this.warn(`${service}: call failed (${(err as Error)?.name ?? "error"}), skipped`);
      }
      return null;
    }
  }
}

export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function isRateLimit(err: unknown): boolean {
  if (err instanceof RateLimitedError) return true;
  const e = err as { status?: unknown; code?: unknown } | null;
  return e?.status === 429 || e?.code === 429;
}

let shared: QuotaGuard | undefined;

/** Process-wide guard with overrides from QUOTA_LIMITS. */
export function getQuotaGuard(): QuotaGuard {
  if (!shared) {
    const parsed = parseQuotaLimits(process.env.QUOTA_LIMITS ?? "");
    if (typeof parsed === "string") throw new Error(parsed);
    shared = new QuotaGuard({ overrides: parsed });
  }
  return shared;
}
