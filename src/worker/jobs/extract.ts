import { lookup, toCells, type GeocodeOutcome, type Geometry, type LookupMatch } from "@/lib/gazetteer";
import { extractAll, type LlmProvider } from "@/lib/llm";
import { credibility, RULES_CONFIDENCE_FACTOR, sourceClassOf } from "@/lib/scoring/credibility";
import type { IngestStore, NewEvent, NewPlannedEvent, PendingRawItem } from "../ingest/store";
import { errInfo, errSummary, logger } from "@/lib/log";

const xlog = logger("extract");

// Extraction pipeline (every 2 min): unprocessed raw_items → extractor (fallback: rules) →
// drop irrelevant / old_or_unclear → resolve locations (gazetteer, then Nominatim) → events.

export const EXTRACT_SCHEDULE = "*/2 * * * *";
const MAX_ITEMS_PER_RUN = 60;

export type ExtractDeps = {
  store: IngestStore;
  provider: LlmProvider;
  rules: LlmProvider;
  /** Gazetteer first, Nominatim for unknown phrases (geocodePlace). */
  geocode: (phrase: string) => Promise<GeocodeOutcome>;
  now: () => Date;
};

export type ExtractSummary = {
  items: number;
  events: number;
  /** Announced future events stored in planned_events. */
  planned: number;
  dropped: number;
  unlocated: number;
  /** Left for the next run: the LLM was temporarily unavailable (overload, quota). */
  deferred: number;
  byExtractor: Record<string, number>;
};

const PLANNED_MAX_AHEAD_MS = 30 * 86_400_000;
/**
 * How long an item may wait for the LLM to come back (Gemini overloaded, quota used up) before
 * it is extracted with rules anyway. A few runs' delay buys a much better reading.
 */
export const DEFER_MAX_MS = 15 * 60_000;

// Streets and squares beat whole neighbourhoods when a phrase matches both.
const preferSpecific = (ms: LookupMatch[]) => {
  const specific = ms.filter((m) => m.type !== "area");
  return specific.length ? specific : ms;
};

async function resolveLocations(phrases: string[], text: string, geocode: ExtractDeps["geocode"]) {
  const names = new Set<string>();
  const geometries: Geometry[] = [];
  for (const phrase of phrases) {
    const clean = phrase.replace(/[@#]\S+/g, "").trim(); // never keep handles/hashtags as place names
    if (!clean) continue;
    const r = await geocode(clean);
    if (r.source === "gazetteer") {
      for (const m of preferSpecific(r.matches)) {
        names.add(m.name);
        geometries.push(m.geometry);
      }
    } else if (r.source === "nominatim") {
      names.add(r.result.name);
      geometries.push(r.result.geometry);
    }
  }
  // Nothing usable from the extractor: scan the text with the gazetteer (offline only —
  // full text never goes to Nominatim).
  if (!geometries.length) {
    for (const m of preferSpecific(lookup(text))) {
      names.add(m.name);
      geometries.push(m.geometry);
    }
  }
  const cells = new Set(geometries.flatMap((g) => toCells(g)));
  return { names: [...names], cells: [...cells].sort() };
}

/** One extraction pass. Never throws; records status as adapter "extract". */
export async function runExtraction(deps: ExtractDeps): Promise<ExtractSummary> {
  const started = deps.now();
  const summary: ExtractSummary = { items: 0, events: 0, planned: 0, dropped: 0, unlocated: 0, deferred: 0, byExtractor: {} };
  const issues = new Set<string>();
  let error: string | null = null;

  try {
    const pending: PendingRawItem[] = await deps.store.unprocessed(MAX_ITEMS_PER_RUN);
    summary.items = pending.length;
    if (pending.length) {
      const byId = new Map(pending.map((p) => [String(p.id), p]));
      const extracted = await extractAll(
        pending.map((p) => ({ id: String(p.id), text: p.text, publishedAt: p.publishedAt })),
        deps.provider,
        deps.rules,
        (issue) => issues.add(issue),
        (id) => deps.now().getTime() - byId.get(id)!.fetchedAt.getTime() < DEFER_MAX_MS,
      );
      const done = new Set(extracted.map((e) => e.id));
      summary.deferred = pending.length - done.size;

      const events: NewEvent[] = [];
      const planned: NewPlannedEvent[] = [];
      for (const { id, extraction: ex, extractor } of extracted) {
        summary.byExtractor[extractor] = (summary.byExtractor[extractor] ?? 0) + 1;
        const item = byId.get(id)!;
        // Announcements need a valid start in the next 30 days (from any extractor).
        const startsAt = ex.time_reference === "planned" && ex.planned_start ? new Date(ex.planned_start) : null;
        const validStart =
          !!startsAt && !Number.isNaN(startsAt.getTime()) &&
          startsAt.getTime() > deps.now().getTime() - 3_600_000 &&
          startsAt.getTime() < deps.now().getTime() + PLANNED_MAX_AHEAD_MS;
        if (!ex.relevant || !ex.event_type || ex.time_reference === "old_or_unclear" || (ex.time_reference === "planned" && !validStart)) {
          summary.dropped++;
          continue;
        }
        const { names, cells } = await resolveLocations(ex.locations, item.text, deps.geocode);
        if (!cells.length) {
          summary.unlocated++; // no area to map
          continue;
        }
        const cls = sourceClassOf(item.source, item.feed);
        const confidence = Math.round(ex.confidence * (extractor === "rules" ? RULES_CONFIDENCE_FACTOR : 1) * 100) / 100;
        if (ex.time_reference === "planned") {
          planned.push({
            rawItemId: item.id,
            source: item.source,
            sourceFeed: `${item.source}:${item.feed}`,
            authorKey: item.authorKey ?? null,
            eventType: ex.event_type,
            startsAt: startsAt!,
            timeKnown: ex.planned_time_known,
            counter: ex.counter_protest,
            recurring: ex.recurring,
            locationNames: names,
            h3Cells: cells,
            sourceClass: cls,
            extractor,
            confidence,
            credibility: credibility(cls, item.authorMeta, false),
          });
          continue;
        }
        events.push({
          rawItemId: item.id,
          source: item.source,
          sourceFeed: `${item.source}:${item.feed}`,
          authorKey: item.authorKey ?? null,
          eventType: ex.event_type,
          severity: ex.severity,
          confidence: Math.round(ex.confidence * (extractor === "rules" ? RULES_CONFIDENCE_FACTOR : 1) * 100) / 100,
          isFirsthand: ex.is_firsthand,
          credibility: credibility(cls, item.authorMeta, ex.is_firsthand),
          // Dated by publication; "yesterday" a day earlier. Either way, anything older than the
          // 4h scoring window is history for the forecast only (never current levels).
          occurredAt: new Date((item.publishedAt ?? item.fetchedAt).getTime() - (ex.time_reference === "yesterday" ? 86_400_000 : 0)),
          locationNames: names,
          h3Cells: cells,
          sourceClass: cls,
          extractor,
        });
      }

      await deps.store.insertEvents(events);
      await deps.store.insertPlanned(planned);
      // Deferred items stay unprocessed, so the next run picks them up again.
      await deps.store.markProcessed(pending.filter((p) => done.has(String(p.id))).map((p) => p.id));
      summary.events = events.length;
      summary.planned = planned.length;
    }
  } catch (err) {
    error = errSummary(err);
    xlog.error(errInfo(err), "extraction failed");
  }

  const finished = deps.now();
  await deps.store
    .saveStatus({
      adapter: "extract",
      status: error ? "error" : "ok",
      lastRunAt: finished,
      ...(error ? {} : { lastSuccessAt: finished }),
      fetched: summary.items,
      inserted: summary.events,
      duplicates: 0,
      durationMs: finished.getTime() - started.getTime(),
      lastError: error,
      // Only runs that extracted something replace the counters /admin shows
      // (undefined leaves the stored value untouched).
      details: summary.items
        ? {
            provider: deps.provider.name,
            byExtractor: summary.byExtractor,
            // Items the configured LLM could not answer (quota, errors, invalid output).
            fallbacks: deps.provider.name === "rules" ? 0 : (summary.byExtractor.rules ?? 0),
            // Why the LLM didn't answer (API error, blocked/truncated answer, rejected fields).
            ...(issues.size ? { providerIssue: [...issues].join(" | ").slice(0, 500) } : {}),
            dropped: summary.dropped,
            unlocated: summary.unlocated,
            deferred: summary.deferred,
          }
        : undefined,
    })
    .catch((err) => xlog.error(errInfo(err), "could not save status"));

  if (summary.items) {
    xlog.info({ ...summary, provider: deps.provider.name }, "extraction finished");
  }
  return summary;
}
