import { describe, expect, it } from "vitest";
import { formatAgo } from "./time";

describe("formatAgo", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it.each([
    ["2026-10-21T11:59:30Z", "just now"],
    ["2026-10-21T11:55:00Z", "5 min ago"],
    ["2026-10-21T10:30:00Z", "1 h 30 min ago"],
  ])("%s → %s", (iso, expected) => {
    expect(formatAgo(iso, now)).toBe(expected);
  });
});
