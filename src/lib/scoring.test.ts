import { gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { decay, DEFAULT_THRESHOLDS, levelFor, parseThresholds, scoreCells, TYPE_WEIGHTS, type ScoringEvent } from "./scoring";

const NOW = new Date("2026-10-21T12:00:00Z");
const A = latLngToCell(44.4967, 11.35, 9); // Piazza Verdi
const B = latLngToCell(44.5058, 11.343, 9); // Stazione
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function ev(over: Partial<ScoringEvent> = {}): ScoringEvent {
  return {
    eventType: "clashes",
    credibility: 1,
    confidence: 1,
    occurredAt: NOW,
    h3Cells: [A],
    sourceFeed: "news:carlino",
    sourceClass: "news",
    ...over,
  };
}
const cell = (cells: ReturnType<typeof scoreCells>, h3: string) => cells.find((c) => c.h3 === h3);

describe("decay", () => {
  it("is exp(-age/50)", () => {
    expect(decay(0)).toBe(1);
    expect(decay(50)).toBeCloseTo(Math.exp(-1), 10);
    expect(decay(100)).toBeCloseTo(Math.exp(-2), 10);
    expect(decay(-5)).toBe(1); // clock skew: future events count as now
  });

  it("drives the score: Σ weight × credibility × confidence × decay", () => {
    const cells = scoreCells(
      [ev({ eventType: "march", credibility: 0.85, confidence: 0.8, occurredAt: minutesAgo(25) }), ev({ eventType: "blockade", credibility: 0.8, confidence: 0.7 })],
      [],
      NOW,
    );
    const expected = TYPE_WEIGHTS.march * 0.85 * 0.8 * Math.exp(-0.5) + TYPE_WEIGHTS.blockade * 0.8 * 0.7;
    expect(cell(cells, A)!.score).toBeCloseTo(expected, 3);
  });

  it("only counts events from the last 4 hours", () => {
    const cells = scoreCells([ev({ occurredAt: minutesAgo(241), h3Cells: [B] }), ev({ occurredAt: minutesAgo(239) })], [], NOW);
    expect(cell(cells, B)).toBeUndefined();
    expect(cell(cells, A)!.score).toBeGreaterThan(0);
  });
});

describe("levelFor", () => {
  it.each<[number, number]>([
    [0, 0], [0.149, 0], [0.15, 1], [0.399, 1], [0.4, 2], [0.799, 2], [0.8, 3], [1.399, 3], [1.4, 4], [9, 4],
  ])("score %s → level %s", (score, level) => {
    expect(levelFor(score)).toBe(level);
  });

  it("uses custom thresholds", () => {
    expect(levelFor(0.3, [0.1, 0.2, 0.3, 0.4])).toBe(3);
    expect(parseThresholds("0.1,0.2,0.3,0.4")).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(parseThresholds("0.4,0.3,0.2,0.1")).toMatch(/increasing/);
    expect(parseThresholds("1,2")).toMatch(/4 positive/);
    expect(DEFAULT_THRESHOLDS).toEqual([0.15, 0.4, 0.8, 1.4]);
  });
});

describe("corroboration cap (rule 3)", () => {
  const social = (feed: string) => ev({ sourceClass: "social", sourceFeed: feed, credibility: 0.7 });

  it("caps a single social source at level 2, however strong", () => {
    const cells = scoreCells([social("reddit:r/bologna"), social("reddit:r/bologna"), social("reddit:r/bologna")], [], NOW);
    expect(cell(cells, A)).toMatchObject({ level: 2, sourceCount: 1, officialSource: false });
    expect(cell(cells, A)!.score).toBeGreaterThan(1.4);
  });

  it("lifts the cap with two independent sources", () => {
    const cells = scoreCells([social("reddit:r/bologna"), social("bluesky:search"), social("bluesky:search")], [], NOW);
    expect(cell(cells, A)).toMatchObject({ level: 4, sourceCount: 2 });
  });

  it("lifts the cap with one news, official or transit source", () => {
    for (const sourceClass of ["news", "official", "transit"] as const) {
      const cells = scoreCells([ev({ sourceClass, sourceFeed: `${sourceClass}:x`, credibility: 1 }), ev({ sourceClass, sourceFeed: `${sourceClass}:x` })], [], NOW);
      expect(cell(cells, A)).toMatchObject({ level: 4, officialSource: true });
    }
  });

  it("does not affect levels up to 2", () => {
    const cells = scoreCells([social("reddit:r/bologna")], [], NOW); // 1 × 0.7 → level 2
    expect(cell(cells, A)!.level).toBe(2);
  });
});

describe("smoothing", () => {
  it("raises the ring around a level-4 cell to at least 1", () => {
    const cells = scoreCells([ev(), ev({ sourceFeed: "news:repubblica" })], [], NOW);
    expect(cell(cells, A)!.level).toBe(4);
    const ring = gridDisk(A, 1).filter((h) => h !== A);
    expect(ring).toHaveLength(6);
    for (const h of ring) expect(cell(cells, h)).toMatchObject({ level: 1, score: 0, sourceCount: 0, lastReportAt: null });
  });

  it("never lowers a neighbour that is already higher", () => {
    const neighbour = gridDisk(A, 1).find((h) => h !== A)!;
    const cells = scoreCells([ev(), ev({ sourceFeed: "news:repubblica" }), ev({ h3Cells: [neighbour], eventType: "police_presence" })], [], NOW);
    // 0.3 × 1 × 1 → level 1 by score; a second police event would make it 2:
    const cells2 = scoreCells(
      [ev(), ev({ sourceFeed: "news:repubblica" }), ev({ h3Cells: [neighbour], eventType: "march" })],
      [],
      NOW,
    );
    expect(cell(cells, neighbour)!.level).toBe(1);
    expect(cell(cells2, neighbour)!.level).toBe(2);
  });
});

describe("overrides", () => {
  const future = new Date(NOW.getTime() + 3_600_000);

  it("are applied last and win over score, cap and smoothing", () => {
    const neighbour = gridDisk(A, 1).find((h) => h !== A)!;
    const cells = scoreCells(
      [ev(), ev({ sourceFeed: "news:repubblica" })],
      [
        { h3: A, level: 0, expiresAt: future },
        { h3: neighbour, level: 3, expiresAt: future },
      ],
      NOW,
    );
    expect(cell(cells, A)).toMatchObject({ level: 0, overridden: true });
    expect(cell(cells, neighbour)).toMatchObject({ level: 3, overridden: true });
  });

  it("can raise a capped cell and create cells with no events", () => {
    const cells = scoreCells([ev({ sourceClass: "social", sourceFeed: "reddit:r/bologna" })], [
      { h3: A, level: 4, expiresAt: future },
      { h3: B, level: 2, expiresAt: future },
    ], NOW);
    expect(cell(cells, A)!.level).toBe(4);
    expect(cell(cells, B)).toMatchObject({ level: 2, overridden: true, eventTypes: [] });
  });

  it("ignore expired overrides", () => {
    const cells = scoreCells([ev()], [{ h3: A, level: 0, expiresAt: NOW }], NOW);
    expect(cell(cells, A)).toMatchObject({ overridden: false });
    expect(cell(cells, A)!.level).toBeGreaterThan(0);
  });
});
