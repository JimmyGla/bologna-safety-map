import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { quotaLedger } from "@/db/schema";
import type { QuotaGuard, QuotaLedger } from "@/lib/quota";

/** quota_ledger-backed daily counters (CLAUDE.md rule 5). */
export class DbQuotaLedger implements QuotaLedger {
  async record(date: string, service: string, kind: "request" | "429") {
    const inc = kind === "request" ? { requests: 1, errors429: 0 } : { requests: 0, errors429: 1 };
    await db
      .insert(quotaLedger)
      .values({ date, service, ...inc })
      .onConflictDoUpdate({
        target: [quotaLedger.date, quotaLedger.service],
        set: {
          requests: sql`${quotaLedger.requests} + ${inc.requests}`,
          errors429: sql`${quotaLedger.errors429} + ${inc.errors429}`,
        },
      });
  }

  /** Seeds the guard with today's totals from earlier runs. */
  async seed(guard: QuotaGuard, date: string) {
    const rows = await db.select().from(quotaLedger).where(eq(quotaLedger.date, date));
    for (const r of rows) guard.seedDaily(r.service, date, r.requests);
  }
}
