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

  it("does not throw when the store fails", async () => {
    const store = new MemoryScoreStore(() => {
      throw new Error("db down");
    });
    await expect(runScoring(store, DEFAULT_THRESHOLDS, () => NOW)).resolves.toBeNull();
  });
});
