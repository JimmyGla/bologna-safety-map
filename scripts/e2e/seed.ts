// Seeds the LOCAL database with end-to-end fixtures. Refuses any non-local DATABASE_URL.
//   npm run e2e:seed
import "../../src/worker/load-env";
import { latLngToCell } from "h3-js";
import { like, sql } from "drizzle-orm";
import { lookup } from "../../src/lib/gazetteer";
import { centroidOf } from "./util";
import { FIXTURE_TAG, OVERRIDE, PLACES, POSTED_MINUTES_AGO, RAW_FIXTURES } from "./fixtures";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`refusing to seed a non-local database (${url.hostname})`);
  }
  const { db } = await import("../../src/db");
  const { cellOverrides, events, plannedEvents, rawItems } = await import("../../src/db/schema");

  // Clean previous fixture runs.
  await db.delete(events).where(like(events.sourceFeed, `%:${FIXTURE_TAG}-%`));
  await db.delete(plannedEvents).where(like(plannedEvents.sourceFeed, `%:${FIXTURE_TAG}-%`));
  await db.delete(rawItems).where(like(rawItems.feed, `${FIXTURE_TAG}-%`));
  await db.delete(cellOverrides).where(like(cellOverrides.reason, `%${FIXTURE_TAG}%`));

  const now = Date.now();
  await db.insert(rawItems).values(
    RAW_FIXTURES.map((f, i) => ({
      source: f.source,
      feed: f.feed,
      externalId: `${FIXTURE_TAG}:${i}`,
      text: f.text,
      publishedAt: new Date(now - POSTED_MINUTES_AGO * 60_000),
      authorMeta: f.authorMeta,
    })),
  );

  // Retention checks: an 8-day-old event and a 25-hour-old raw item must be purged.
  const [old] = await db
    .insert(rawItems)
    .values({ source: "news", feed: `${FIXTURE_TAG}-old`, externalId: `${FIXTURE_TAG}:old`, text: "vecchio", processed: true })
    .returning({ id: rawItems.id });
  await db.execute(sql`update raw_items set fetched_at = now() - interval '25 hours' where id = ${old.id}`);
  await db.insert(events).values({
    source: "news",
    sourceFeed: `news:${FIXTURE_TAG}-old`,
    eventType: "march",
    severity: 1,
    confidence: 0.5,
    credibility: 0.85,
    occurredAt: new Date(now - 8 * 86_400_000),
    h3Cells: [],
    sourceClass: "news",
    extractor: "rules",
  });

  // A manual override on piazza Maggiore.
  const [maggiore] = lookup(PLACES.maggiore);
  const [lng, lat] = centroidOf(maggiore.geometry);
  const h3 = latLngToCell(lat, lng, 9);
  await db.insert(cellOverrides).values({ h3, level: OVERRIDE.level, reason: OVERRIDE.reason, expiresAt: new Date(now + OVERRIDE.minutes * 60_000) });

  const { closeDb } = await import("../../src/db");
  await closeDb();
  console.log(`seeded ${RAW_FIXTURES.length} raw items, 1 stale raw item, 1 old event, override on ${h3}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
