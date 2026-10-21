import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { cellOverrides, events, quotaLedger, rawItems } from "@/db/schema";
import { errInfo, logger } from "@/lib/log";

const plog = logger("purge");

// Retention (runs every 15 min). Snapshots are pruned by the scoring job (1h).
export const RETENTION = {
  rawItems: "24 hours", // CLAUDE.md rule 1
  events: "7 days",
  quotaLedger: "30 days",
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
    const overrides = await db
      .delete(cellOverrides)
      .where(lt(cellOverrides.expiresAt, sql`now()`))
      .returning({ h3: cellOverrides.h3 });
    const ledger = await db
      .delete(quotaLedger)
      .where(lt(quotaLedger.date, sql`(now() - ${RETENTION.quotaLedger}::interval)::date`))
      .returning({ service: quotaLedger.service });
    const counts = { rawItems: raw.length, events: ev.length, overrides: overrides.length, quotaLedger: ledger.length };
    if (Object.values(counts).some(Boolean)) plog.info(counts, "purged");
  } catch (err) {
    plog.error(errInfo(err), "purge failed");
  }
}
