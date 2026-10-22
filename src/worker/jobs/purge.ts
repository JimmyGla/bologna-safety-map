import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { cellOverrides, events, plannedEvents, quotaLedger, rawItems, sourceCursors } from "@/db/schema";
import { AUTHOR_SALT_ADAPTER } from "../ingest/author-key";
import { errInfo, logger } from "@/lib/log";

const plog = logger("purge");

// Retention (runs every 15 min). Snapshots are pruned by the scoring job (1h).
export const RETENTION = {
  rawItems: "24 hours", // CLAUDE.md rule 1
  events: "7 days",
  quotaLedger: "30 days",
  /** Announced events: removed 12 hours after their start. */
  plannedEvents: "12 hours",
  /** Pseudonymous author keys on events (rule 3 counting needs only the last 4h). */
  authorKeys: "24 hours",
  /** Daily salts: once gone, a day's author keys can't be recomputed. */
  authorSalts: "48 hours",
} as const;

/** Deletes expired rows. Never throws. */
export async function purgeExpired(): Promise<void> {
  try {
    const raw = await db
      .delete(rawItems)
      .where(lt(rawItems.fetchedAt, sql`now() - ${RETENTION.rawItems}::interval`))
      .returning({ id: rawItems.id });
    const ev = await db
      .delete(events)
      .where(lt(events.occurredAt, sql`now() - ${RETENTION.events}::interval`))
      .returning({ id: events.id });
    const planned = await db
      .delete(plannedEvents)
      .where(lt(plannedEvents.startsAt, sql`now() - ${RETENTION.plannedEvents}::interval`))
      .returning({ id: plannedEvents.id });
    const overrides = await db
      .delete(cellOverrides)
      .where(lt(cellOverrides.expiresAt, sql`now()`))
      .returning({ h3: cellOverrides.h3 });
    const ledger = await db
      .delete(quotaLedger)
      .where(lt(quotaLedger.date, sql`(now() - ${RETENTION.quotaLedger}::interval)::date`))
      .returning({ service: quotaLedger.service });
    const evKeys = await db
      .update(events)
      .set({ authorKey: null })
      .where(and(isNotNull(events.authorKey), lt(events.createdAt, sql`now() - ${RETENTION.authorKeys}::interval`)))
      .returning({ id: events.id });
    const plannedKeys = await db
      .update(plannedEvents)
      .set({ authorKey: null })
      .where(and(isNotNull(plannedEvents.authorKey), lt(plannedEvents.createdAt, sql`now() - ${RETENTION.authorKeys}::interval`)))
      .returning({ id: plannedEvents.id });
    const salts = await db
      .delete(sourceCursors)
      .where(and(eq(sourceCursors.adapter, AUTHOR_SALT_ADAPTER), lt(sourceCursors.updatedAt, sql`now() - ${RETENTION.authorSalts}::interval`)))
      .returning({ key: sourceCursors.key });
    const counts = {
      rawItems: raw.length,
      events: ev.length,
      planned: planned.length,
      overrides: overrides.length,
      quotaLedger: ledger.length,
      authorKeys: evKeys.length + plannedKeys.length,
      authorSalts: salts.length,
    };
    if (Object.values(counts).some(Boolean)) plog.info(counts, "purged");
  } catch (err) {
    plog.error(errInfo(err), "purge failed");
  }
}
