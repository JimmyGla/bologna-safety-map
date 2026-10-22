import { describe, expect, it } from "vitest";
import { buildReport, parseRange, rangeDays, toCsv, type ReportEvent } from "./aggregate";

const NOW = new Date("2026-10-22T10:00:00Z"); // Thursday 22 Oct, 12:00 in Rome
const Q = ["Navile", "San Donato-San Vitale", "Santo Stefano"];

const ev = (period: string, eventType: ReportEvent["eventType"], quartieri: string[], sourceClass: ReportEvent["sourceClass"] = "news"): ReportEvent => ({
  period,
  eventType,
  quartieri,
  sourceClass,
});

describe("rangeDays", () => {
  it("lists the Rome days of the range, ending today", () => {
    expect(rangeDays(NOW, 3)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(rangeDays(NOW, 30)).toHaveLength(30);
  });
});

describe("buildReport", () => {
  const events = [
    ev("2026-10-22T08:00:00Z", "march", ["Navile"]),
    ev("2026-10-22T08:00:00Z", "clashes", ["Navile", "San Donato-San Vitale"], "social"),
    ev("2026-10-21T22:00:00Z", "sexual_violence", ["Santo Stefano"]), // day precision: 22 Oct in Rome
    ev("2026-10-18T15:00:00Z", "vandalism", ["Navile"]),
    ev("2026-09-01T15:00:00Z", "march", ["Navile"]), // outside the range
  ];
  const levels = [
    { day: "2026-10-22", high: 6, red: 2 },
    { day: "2026-10-18", high: 3, red: 0 },
    { day: "2026-08-01", high: 99, red: 0 },
  ];
  const r = buildReport(events, levels, NOW, 7, Q);

  it("counts events per Rome day and group, inside the range only", () => {
    expect(r.totals).toEqual({ events: 4, daysWithEvents: 2, highAreaHours: 9, authoritativeShare: 0.75 });
    const today = r.byDay.find((d) => d.day === "2026-10-22")!;
    expect(today).toMatchObject({ total: 3, protest: 2, violence: 1, vandalism: 0, highAreaHours: 6 });
    expect(r.byDay).toHaveLength(7);
  });

  it("ranks types and counts quartieri (an event can touch several)", () => {
    expect(r.byType.map((b) => b.type)).toEqual(expect.arrayContaining(["march", "clashes", "sexual_violence", "vandalism"]));
    expect(r.byQuartiere[0]).toMatchObject({ quartiere: "Navile", total: 3, protest: 2, vandalism: 1 });
    expect(r.byQuartiere.find((q) => q.quartiere === "Santo Stefano")).toMatchObject({ violence: 1, total: 1 });
  });

  it("handles an empty archive", () => {
    const empty = buildReport([], [], NOW, 30, Q);
    expect(empty.totals).toEqual({ events: 0, daysWithEvents: 0, highAreaHours: 0, authoritativeShare: 0 });
    expect(empty.byType).toEqual([]);
    expect(empty.byQuartiere.map((q) => q.total)).toEqual([0, 0, 0]);
  });
});

describe("parseRange and toCsv", () => {
  it("accepts only the offered ranges", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("5")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });

  it("quotes fields that need it", () => {
    expect(toCsv(["a", "b"], [["x", 'say "hi", ok']])).toBe('a,b\r\nx,"say ""hi"", ok"\r\n');
  });
});
