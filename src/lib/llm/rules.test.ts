import { describe, expect, it } from "vitest";
import { lookup } from "@/lib/gazetteer";
import { FIXTURES } from "./fixtures";
import { extractWithRules } from "./rules";

const NOW = new Date("2026-10-21T12:00:00Z");

describe("rules extractor on Italian fixtures", () => {
  it.each(FIXTURES)("$name", ({ text, expect: want }) => {
    const got = extractWithRules({ id: "x", text }, NOW);
    const { placeIds, ...fields } = want;
    expect(got).toMatchObject(fields);
    if (placeIds) {
      // Locations are gazetteer names; resolving them again must give the same places.
      const ids = got.locations.flatMap((name) => lookup(name).map((m) => m.id));
      expect([...new Set(ids)].sort()).toEqual(placeIds);
    }
    if (got.relevant) {
      expect(got.confidence).toBeGreaterThan(0);
      expect(got.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it("has at least 15 fixtures, with traps", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(15);
    expect(FIXTURES.filter((f) => f.name.startsWith("TRAP")).length).toBeGreaterThanOrEqual(5);
  });

  it("treats 'nel <this year>' as current", () => {
    expect(extractWithRules({ id: "x", text: "Nel 2026 il corteo più grande, oggi in via Zamboni" }, NOW).relevant).toBe(true);
  });

  it("does not mistake street names for other cities", () => {
    expect(extractWithRules({ id: "x", text: "Corteo in via Roma a Bologna" }, NOW).relevant).toBe(true);
  });

  it("uses publication time when the text has no time words", () => {
    const fresh = extractWithRules({ id: "x", text: "Corteo in via Zamboni", publishedAt: new Date(NOW.getTime() - 30 * 60_000) }, NOW);
    expect(fresh.time_reference).toBe("now");
  });
});
