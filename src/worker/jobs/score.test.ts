import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/lib/scoring";
import { MemoryScoreStore, runScoring } from "./score";

const NOW = new Date("2026-10-21T12:00:00Z");
const A = latLngToCell(44.4967, 11.35, 9);

describe("runScoring", () => {
  it("scores recent events and saves a snapshot", async () => {
    const store = new MemoryScoreStore(() => [
      { eventType: "clashes", credibility: 0.85, confidence: 0.9, occurredAt: NOW, h3Cells: [A], sourceFeed: "news:carlino", sourceClass: "news" },
      { eventType: "clashes", credibility: 0.85, confidence: 0.9, occurredAt: new Date(NOW.getTime() - 5 * 3_600_000), h3Cells: [A], sourceFeed: "news:x", sourceClass: "news" },
    ]);
    const cells = await runScoring(store, DEFAULT_THRESHOLDS, () => NOW);
    expect(cells).toHaveLength(1);
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0].generatedAt).toEqual(NOW);
    expect(store.snapshots[0].cells[0]).toMatchObject({ h3: A, level: 2, sourceCount: 1 }); // the 5h-old event is ignored
  });

  it("puts corroborated upcoming events in the snapshot without touching cell levels", async () => {
    const at = new Date("2026-10-24T13:00:00Z");
    const store = new MemoryScoreStore(
      () => [],
      [],
      () => [
        { eventType: "march", startsAt: at, timeKnown: true, locationNames: ["Piazza Verdi"], h3Cells: [A], sourceFeed: "news:carlino", sourceClass: "news" },
        { eventType: "march", startsAt: at, timeKnown: true, locationNames: ["Piazza Verdi"], h3Cells: [A], sourceFeed: "reddit:r/bologna", sourceClass: "social" },
      ],
    );
    const cells = await runScoring(store, DEFAULT_THRESHOLDS, () => NOW);
    expect(cells).toEqual([]); // no current events → no coloured cells
    expect(store.snapshots[0].planned).toMatchObject([{ eventType: "march", sourceCount: 2, officialSource: true, h3Cells: [A] }]);
  });

  it("saves a forecast built from announcements and the last 7 days, separate from cell levels", async () => {
    const at = new Date("2026-10-24T13:00:00Z");
    const store = new MemoryScoreStore(
      // Two days old: outside the 4h scoring window, inside the forecast history.
      () => [{ eventType: "assault", credibility: 0.85, confidence: 0.9, occurredAt: new Date(NOW.getTime() - 2 * 86_400_000), h3Cells: [A], sourceFeed: "news:carlino", sourceClass: "news" }],
      [],
      () => [{ eventType: "march", startsAt: at, timeKnown: true, locationNames: ["Piazza Verdi"], h3Cells: [A], sourceFeed: "news:carlino", sourceClass: "news" }],
    );
    const cells = await runScoring(store, DEFAULT_THRESHOLDS, () => NOW);
    expect(cells).toEqual([]); // the old assault doesn't colour the current map
    const { forecast } = store.snapshots[0];
    const cell = forecast.cells.find((c) => c.h3 === A)!;
    expect(cell.recentIncidents).toBe(1);
    expect(Math.max(...cell.levels)).toBeGreaterThanOrEqual(2);
    expect(cell.eventIds).toHaveLength(1);
  });

  it("does not throw when the store fails", async () => {
    const store = new MemoryScoreStore(() => {
      throw new Error("db down");
    });
    await expect(runScoring(store, DEFAULT_THRESHOLDS, () => NOW)).resolves.toBeNull();
  });
});

describe("archived levels", () => {
  it("keeps the highest level each cell showed in the hour", async () => {
    const store = new MemoryScoreStore(() => [
      { eventType: "clashes", credibility: 0.85, confidence: 0.9, occurredAt: NOW, h3Cells: [A], sourceFeed: "news:carlino", sourceClass: "news" },
    ]);
    await runScoring(store, DEFAULT_THRESHOLDS, () => NOW);
    const key = `${new Date("2026-10-21T12:00:00Z").toISOString()}|${A}`;
    expect(store.levels.get(key)).toBe(2);
    await store.archiveLevels(new Date("2026-10-21T12:00:00Z"), [{ h3: A, level: 1 }]);
    expect(store.levels.get(key)).toBe(2); // a lower level later in the hour doesn't overwrite it
  });
});
