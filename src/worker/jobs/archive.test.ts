import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { MemoryArchiveStore, runArchive, toArchived, type EventForArchive } from "./archive";

const VERDI = latLngToCell(44.4967, 11.35, 9); // Santo Stefano / San Vitale area
const PILASTRO = latLngToCell(44.5135, 11.3925, 9);

const ev = (over: Partial<EventForArchive> = {}): EventForArchive => ({
  id: 1,
  eventType: "march",
  severity: 1,
  sourceClass: "news",
  extractor: "gemini",
  occurredAt: new Date("2026-10-22T15:42:10Z"),
  h3Cells: [VERDI],
  ...over,
});

describe("toArchived", () => {
  it("keeps protests at hour and cell precision, with their quartiere", () => {
    const a = toArchived(ev());
    expect(a).toMatchObject({ sourceEventId: 1, precision: "hour", eventType: "march", severity: 1, sourceClass: "news", h3Cells: [VERDI] });
    expect(a.period).toEqual(new Date("2026-10-22T15:00:00Z"));
    expect(a.quartieri!.length).toBe(1);
  });

  it("coarsens attacks on people and sexual violence to quartiere and Rome day, without cells", () => {
    for (const eventType of ["assault", "hate_attack", "sexual_violence"] as const) {
      // 23:30 UTC on 22 Oct is 01:30 on 23 Oct in Rome: the Rome day is the 23rd.
      const a = toArchived(ev({ eventType, occurredAt: new Date("2026-10-22T23:30:00Z"), h3Cells: [PILASTRO] }));
      expect(a).toMatchObject({ precision: "day", h3Cells: [] });
      expect(a.period).toEqual(new Date("2026-10-22T22:00:00Z")); // 23 Oct 00:00 Rome
      expect(a.quartieri!.length).toBe(1);
    }
  });

  it("keeps nothing beyond the listed fields", () => {
    expect(Object.keys(toArchived(ev())).sort()).toEqual(
      ["eventType", "extractor", "h3Cells", "period", "precision", "quartieri", "severity", "sourceClass", "sourceEventId"].sort(),
    );
  });
});

describe("runArchive", () => {
  it("copies each event once, across runs", async () => {
    const events = [ev({ id: 1 }), ev({ id: 2, eventType: "clashes" })];
    const store = new MemoryArchiveStore(() => events);
    expect(await runArchive(store)).toBe(2);
    events.push(ev({ id: 3 }));
    expect(await runArchive(store)).toBe(1);
    expect(await runArchive(store)).toBe(0);
    expect(store.archived.map((a) => a.sourceEventId)).toEqual([1, 2, 3]);
  });

  it("never throws", async () => {
    const broken = { unarchivedEvents: async () => Promise.reject(new Error("db down")), insertArchived: async () => 0 };
    await expect(runArchive(broken)).resolves.toBe(0);
  });
});
