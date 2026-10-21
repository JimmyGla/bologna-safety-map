import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { cellOverrides, cellsSnapshot, events, quotaLedger, sourceStatus } from "@/db/schema";
import { quotaOverrides, type Env } from "@/lib/env";
import { DEFAULT_LIMITS, QuotaGuard } from "@/lib/quota";
import type { ScoredCell } from "@/lib/scoring";

// Server-only. Everything /admin shows: aggregated status, never raw item text or authors.

export const SOURCE_FLAGS: Record<string, (env: Env) => boolean> = {
  news: (e) => e.SOURCE_NEWS_ENABLED,
  tper: (e) => e.SOURCE_TPER_ENABLED,
  reddit: (e) => e.SOURCE_REDDIT_ENABLED,
  bluesky: (e) => e.SOURCE_BLUESKY_ENABLED,
  mastodon: (e) => e.SOURCE_MASTODON_ENABLED,
  telegram: (e) => e.SOURCE_TELEGRAM_ENABLED,
};

/** The extractor the worker will actually use with this configuration. */
export function effectiveExtractor(env: Env): { configured: string; active: string; note?: string } {
  if (env.LLM_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
    return { configured: "gemini", active: "rules", note: "GEMINI_API_KEY is empty" };
  }
  return { configured: env.LLM_PROVIDER, active: env.LLM_PROVIDER };
}

export async function loadAdminData(env: Env, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [statusRows, ledgerRows, recentEvents, byExtractor, overrides, [snapshot]] = await Promise.all([
    db.select().from(sourceStatus),
    db.select().from(quotaLedger).where(eq(quotaLedger.date, today)),
    db
      .select({
        id: events.id,
        occurredAt: events.occurredAt,
        eventType: events.eventType,
        severity: events.severity,
        confidence: events.confidence,
        credibility: events.credibility,
        h3Cells: events.h3Cells,
        locationNames: events.locationNames,
        source: events.source,
        sourceClass: events.sourceClass,
        extractor: events.extractor,
      })
      .from(events)
      .orderBy(desc(events.occurredAt))
      .limit(50),
    db
      .select({ extractor: events.extractor, count: sql<number>`count(*)::int` })
      .from(events)
      .where(and(gte(events.createdAt, dayAgo), sql`${events.source} <> 'tper'`))
      .groupBy(events.extractor),
    db.select().from(cellOverrides).where(gt(cellOverrides.expiresAt, now)).orderBy(desc(cellOverrides.createdAt)),
    db
      .select({ generatedAt: cellsSnapshot.generatedAt, cells: cellsSnapshot.cells, reducedAccuracy: cellsSnapshot.reducedAccuracy })
      .from(cellsSnapshot)
      .orderBy(desc(cellsSnapshot.generatedAt))
      .limit(1),
  ]);

  const status = new Map(statusRows.map((r) => [r.adapter, r]));
  const sources = Object.entries(SOURCE_FLAGS).map(([id, flag]) => ({ id, enabled: flag(env), status: status.get(id) ?? null }));

  const limits = new QuotaGuard({ overrides: quotaOverrides(env), warn: () => {} });
  const used = new Map(ledgerRows.map((r) => [r.service, r]));
  const services = [...new Set([...Object.keys(DEFAULT_LIMITS), ...used.keys()])].sort();
  const quota = services.map((service) => {
    const limit = limits.limitFor(service);
    const row = used.get(service);
    return { service, requests: row?.requests ?? 0, errors429: row?.errors429 ?? 0, perDay: limit.perDay, perMinute: limit.perMinute };
  });

  const extractRun = status.get("extract") ?? null;
  const counts = Object.fromEntries(byExtractor.map((r) => [r.extractor, r.count]));
  const total24h = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    now,
    sources,
    extractRun,
    quota,
    extractor: { ...effectiveExtractor(env), last24h: counts, rulesShare24h: total24h ? (counts.rules ?? 0) / total24h : 0 },
    events: recentEvents,
    overrides,
    snapshot: snapshot
      ? { generatedAt: snapshot.generatedAt, cells: snapshot.cells as ScoredCell[], reducedAccuracy: snapshot.reducedAccuracy }
      : null,
  };
}

export type AdminData = Awaited<ReturnType<typeof loadAdminData>>;
