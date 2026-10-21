// Verifies the end-to-end run against the running app (default http://localhost:3000).
//   npm run e2e:check
import "../../src/worker/load-env";
import { gridDisk, latLngToCell } from "h3-js";
import { like } from "drizzle-orm";
import { lookup, toCells } from "../../src/lib/gazetteer";
import { cellsResponseSchema, type CellProperties } from "../../src/lib/cells";
import { FIXTURE_TAG, OVERRIDE, PLACES } from "./fixtures";
import { centroidOf } from "./util";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const results: { ok: boolean; name: string; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ ok, name, detail });

const cellsOf = (phrase: string) => {
  const ms = lookup(phrase).filter((m) => m.type !== "area");
  return new Set(ms.flatMap((m) => toCells(m.geometry)));
};

async function main() {
  const res = await fetch(`${BASE}/api/cells`);
  const raw = await res.text();
  check("/api/cells answers 200", res.ok, `HTTP ${res.status}`);
  const body = cellsResponseSchema.parse(JSON.parse(raw));
  check("cache header is 30s", (res.headers.get("cache-control") ?? "").includes("max-age=30"), res.headers.get("cache-control") ?? "");
  check("snapshot is fresh (<2 min)", !!body.generatedAt && Date.now() - Date.parse(body.generatedAt) < 120_000, body.generatedAt ?? "null");
  check("no text, URLs or fixture names in the response", !/fixture|https?:\/\/|u\/|Scontri|lacrimogeni/i.test(raw));
  check("reduced-accuracy flag is on (rules extractor)", body.reducedAccuracy === true);

  const byH3 = new Map<string, CellProperties>(body.features.map((f) => [f.properties.h3, f.properties]));
  const level = (h: string) => byH3.get(h)?.level ?? 0;

  // Piazza Verdi: 6 independent news reports of clashes → level 4.
  const verdi = cellsOf(PLACES.verdi);
  const verdiLevels = [...verdi].map(level);
  check("piazza Verdi cells are level 4", verdi.size > 0 && verdiLevels.every((l) => l === 4), `levels ${verdiLevels.join(",")}`);
  check("piazza Verdi has 6 independent sources", [...verdi].every((h) => byH3.get(h)?.sourceCount === 6));

  // Smoothing: every neighbour of a level-4 cell is ≥ 1.
  const ring = [...verdi].flatMap((h) => gridDisk(h, 1)).filter((h) => !verdi.has(h));
  check("ring around level 4 is at least level 1", ring.every((h) => level(h) >= 1), `${ring.filter((h) => level(h) < 1).length} below`);

  // Via Massarenti: one social feed only → capped at level 2 despite a high score.
  const massa = [...cellsOf(PLACES.massarenti)].filter((h) => !ring.includes(h) && !verdi.has(h));
  const massaCells = massa.map((h) => byH3.get(h)).filter((c): c is CellProperties => !!c);
  check("via Massarenti is capped at level 2", massaCells.length > 0 && massaCells.every((c) => c.level <= 2), `levels ${[...new Set(massaCells.map((c) => c.level))].join(",")}`);
  // Score alone would give level 3+ (≥ 0.8); the cap holds it at 2.
  check("via Massarenti is held at 2 by the cap (score says 3+)", massaCells.some((c) => c.level === 2 && c.score >= 0.8), `max score ${Math.max(0, ...massaCells.map((c) => c.score)).toFixed(2)}`);
  check("via Massarenti: 1 source, no official source", massaCells.every((c) => c.sourceCount === 1 && !c.officialSource));

  // TPER diversion → blockade, official.
  const indip = [...cellsOf(PLACES.indipendenza)].map((h) => byH3.get(h)).filter((c): c is CellProperties => !!c && !c.overridden);
  check("via Indipendenza has blockade cells counted as official", indip.length > 0 && indip.every((c) => c.level >= 1 && c.officialSource && c.eventTypes.includes("blockade")));

  // Override on piazza Maggiore.
  const [lng, lat] = centroidOf(lookup(PLACES.maggiore)[0].geometry);
  const maggiore = byH3.get(latLngToCell(lat, lng, 9));
  check("piazza Maggiore override applied", maggiore?.level === OVERRIDE.level && maggiore.overridden === true, JSON.stringify(maggiore ?? null));


  // Health.
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("/api/health: database ok, degraded only by reduced accuracy", health.database === "ok" && health.status === "degraded" && health.snapshot.stale === false, JSON.stringify(health));

  // Retention (purge ran in worker:once).
  const { db } = await import("../../src/db");
  const { events, rawItems } = await import("../../src/db/schema");
  const oldEvents = await db.select({ id: events.id }).from(events).where(like(events.sourceFeed, `%:${FIXTURE_TAG}-old`));
  const oldRaw = await db.select({ id: rawItems.id }).from(rawItems).where(like(rawItems.feed, `${FIXTURE_TAG}-old`));
  check("events older than 7 days were deleted", oldEvents.length === 0);
  check("raw items older than 24h were deleted", oldRaw.length === 0);
  // Traps (old video, Milan) must not become events.
  const trapEvents = await db.select({ id: events.id }).from(events).where(like(events.sourceFeed, `%:${FIXTURE_TAG}-trap-%`));
  check("trap fixtures produced no events", trapEvents.length === 0, `${trapEvents.length} events`);

  const { closeDb } = await import("../../src/db");
  await closeDb();

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  (${r.detail})` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
