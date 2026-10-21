import { describe, expect, it } from "vitest";
import { DANGER_LEVELS } from "./danger-levels";

describe("DANGER_LEVELS", () => {
  it("matches the levels defined in CLAUDE.md", () => {
    expect(DANGER_LEVELS.map((d) => [d.level, d.color, d.label])).toEqual([
      [0, "grey", "No data"],
      [1, "green", "Low"],
      [2, "yellow", "Moderate"],
      [3, "orange", "High"],
      [4, "red", "Severe"],
    ]);
  });
});
