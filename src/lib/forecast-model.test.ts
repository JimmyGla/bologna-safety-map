import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { forecastBlocks, forecastSchema } from "./forecast";
import { buildForecast, type HistoryEvent } from "./forecast-model";
import type { UpcomingEvent } from "./planned";

// Wednesday 21 Oct 2026, 14:00 in Rome.
const NOW = new Date("2026-10-21T12:00:00Z");
const VERDI = latLngToCell(44.4967, 11.35, 9);
const MAGGIORE = latLngToCell(44.4938, 11.3431, 9); // ~650 m from Verdi
const FAR = latLngToCell(44.47, 11.3, 9);

// Saturday 24 Oct, 15:00 Rome = 13:00 UTC; block "Sat 12–18" is 10:00–16:00 UTC.
const SAT_15 = "2026-10-24T13:00:00.000Z";

function ev(over: Partial<UpcomingEvent> = {}): UpcomingEvent {
  return {
    id: "e1",
    eventType: "march",
    startsAt: SAT_15,
    timeKnown: true,
    locationNames: ["Piazza Verdi"],
    h3Cells: [VERDI],
    sourceCount: 1,
    officialSource: true,
    counter: false,
    ...over,
  };
}

function incident(over: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    eventType: "clashes",
    credibility: 0.9,
    confidence: 0.9,
    occurredAt: new Date(NOW.getTime() - 3_600_000),
    h3Cells: [VERDI],
    sourceFeed: "news:carlino",
    sourceClass: "news",
    ...over,
  };
}

const forecast = (up: UpcomingEvent[], hist: HistoryEvent[] = []) => buildForecast(up, hist, NOW);
const satBlock = (f: ReturnType<typeof forecast>) => f.blocks.findIndex((b) => b.start === "2026-10-24T10:00:00.000Z");
const level = (f: ReturnType<typeof forecast>, h3: string, block: number) => f.cells.find((c) => c.h3 === h3)?.levels[block] ?? 0;
const maxLevel = (f: ReturnType<typeof forecast>, h3: string) => Math.max(0, ...(f.cells.find((c) => c.h3 === h3)?.levels ?? []));

describe("forecastBlocks", () => {
  it("starts at the Rome 6-hour block containing now and covers 72h", () => {
    const blocks = forecastBlocks(NOW);
    expect(blocks[0].start.toISOString()).toBe("2026-10-21T10:00:00.000Z"); // 12:00 Rome
    expect(blocks[blocks.length - 1].end.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 72 * 3_600_000);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i].start).toEqual(blocks[i - 1].end);
  });

  it("follows Rome's clock across the end of summer time (25 Oct 2026)", () => {
    const blocks = forecastBlocks(new Date("2026-10-24T20:00:00Z")); // Sat 22:00 Rome
    const night = blocks.find((b) => b.start.toISOString() === "2026-10-24T22:00:00.000Z")!; // Sun 00:00 CEST
    expect(night.end.toISOString()).toBe("2026-10-25T05:00:00.000Z"); // 06:00 CET: a 7-hour block
  });
});

describe("buildForecast", () => {
  it("returns a valid, empty forecast with nothing announced or recent", () => {
    const f = forecast([]);
    expect(() => forecastSchema.parse(f)).not.toThrow();
    expect(f.cells).toEqual([]);
  });

  it("puts an announced march in its own block and cell, fading around it", () => {
    const f = forecast([ev()]);
    const i = satBlock(f);
    expect(level(f, VERDI, i)).toBeGreaterThanOrEqual(1);
    expect(level(f, VERDI, i - 2)).toBe(0); // Saturday morning: nothing yet
    expect(level(f, FAR, i)).toBe(0);
    expect(f.cells.find((c) => c.h3 === VERDI)?.eventIds).toEqual(["e1"]);
    expect(f.cells.length).toBeGreaterThan(1); // the neighbours get some of it
  });

  it("raises the risk when an opposing event is nearby at the same time", () => {
    const alone = forecast([ev()]);
    const opposed = forecast([ev(), ev({ id: "e2", h3Cells: [MAGGIORE], counter: true })]);
    const i = satBlock(alone);
    expect(level(opposed, VERDI, i)).toBeGreaterThan(level(alone, VERDI, i));
    expect(level(opposed, VERDI, i)).toBeGreaterThanOrEqual(3);
    expect(opposed.cells.find((c) => c.h3 === VERDI)?.counter).toBe(true);
  });

  it("raises unrelated concurrent gatherings less than a declared counter-event", () => {
    const concurrent = forecast([ev(), ev({ id: "e2", h3Cells: [MAGGIORE] })]);
    const counter = forecast([ev(), ev({ id: "e2", h3Cells: [MAGGIORE], counter: true })]);
    const i = satBlock(concurrent);
    expect(level(concurrent, VERDI, i)).toBeLessThan(level(counter, VERDI, i));
  });

  it("does not treat far-away or different-day events as opposing", () => {
    const alone = forecast([ev()]);
    const far = forecast([ev(), ev({ id: "e2", h3Cells: [FAR], counter: true })]);
    const otherDay = forecast([ev(), ev({ id: "e2", h3Cells: [MAGGIORE], startsAt: "2026-10-23T13:00:00.000Z" })]);
    const i = satBlock(alone);
    expect(level(far, VERDI, i)).toBe(level(alone, VERDI, i));
    expect(level(otherDay, VERDI, i)).toBe(level(alone, VERDI, i));
  });

  it("weighs announced squad attacks highest", () => {
    const f = forecast([ev({ eventType: "hate_attack" })]);
    expect(level(f, VERDI, satBlock(f))).toBeGreaterThanOrEqual(3);
  });

  it("is less certain about day-only announcements and less-corroborated ones", () => {
    const timed = forecast([ev({ eventType: "clashes" })]);
    const dayOnly = forecast([ev({ eventType: "clashes", timeKnown: false, startsAt: "2026-10-23T22:00:00.000Z" })]);
    const social = forecast([ev({ eventType: "clashes", officialSource: false, sourceCount: 2 })]);
    const i = satBlock(timed);
    expect(level(dayOnly, VERDI, i)).toBeLessThan(level(timed, VERDI, i));
    expect(level(social, VERDI, i)).toBeLessThan(level(timed, VERDI, i));
  });

  it("raises an announced event where violence happened recently", () => {
    const clean = forecast([ev()]);
    const troubled = forecast([ev()], [incident(), incident({ sourceFeed: "news:repubblica" })]);
    const i = satBlock(clean);
    expect(level(troubled, VERDI, i)).toBeGreaterThan(level(clean, VERDI, i));
  });

  it("caps history-only cells at level 2, however many incidents", () => {
    const many = Array.from({ length: 20 }, (_, k) => incident({ eventType: "hate_attack", sourceFeed: `news:${k}` }));
    const f = forecast([], many);
    expect(maxLevel(f, VERDI)).toBe(2);
    expect(f.cells.find((c) => c.h3 === VERDI)?.recentIncidents).toBe(20);
  });

  it("ignores non-violent and old history, and events beyond the horizon", () => {
    const f = forecast(
      [ev({ startsAt: "2026-10-27T13:00:00.000Z" })],
      [incident({ eventType: "march" }), incident({ occurredAt: new Date(NOW.getTime() - 8 * 86_400_000) })],
    );
    expect(f.cells).toEqual([]);
  });

  it("lets recent history fade further ahead", () => {
    const f = forecast([], [incident()]);
    const levels = f.cells.find((c) => c.h3 === VERDI)!.levels;
    expect(levels[0]).toBeGreaterThanOrEqual(levels[levels.length - 1]);
  });
});
