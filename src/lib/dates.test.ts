import { describe, expect, it } from "vitest";
import { parsePlannedStart, romeDay, romeTime } from "./dates";

// Wednesday 21 October 2026, 14:00 in Rome (UTC+2, summer time).
const NOW = new Date("2026-10-21T12:00:00Z");
const iso = (s: string) => new Date(s).toISOString();

describe("parsePlannedStart", () => {
  it.each<[string, string, boolean, string]>([
    ["Corteo sabato 24 ottobre alle 15 da piazza XX Settembre", "2026-10-24T13:00:00Z", true, "explicit"],
    ["Manifestazione il 24/10 ore 17:30 in piazza Maggiore", "2026-10-24T15:30:00Z", true, "explicit"],
    ["Presidio domani dalle 18.30 davanti alla prefettura", "2026-10-22T16:30:00Z", true, "relative"],
    ["Domani corteo studentesco, previste deviazioni", "2026-10-21T22:00:00Z", false, "relative"],
    ["Dopodomani sit-in in via Zamboni alle 10", "2026-10-23T08:00:00Z", true, "relative"],
    ["Sabato corteo per la Palestina, appuntamento alle 15 in piazza Verdi", "2026-10-24T13:00:00Z", true, "weekday"],
    ["Stasera alle 21 fiaccolata in piazza Maggiore", "2026-10-21T19:00:00Z", true, "relative"],
    ["Il corteo partirà venerdì alle ore 9:30", "2026-10-23T07:30:00Z", true, "weekday"],
    ["Mercoledì prossimo presidio alle 12", "2026-10-28T11:00:00Z", true, "weekday"], // after the 25 Oct switch to winter time
    ["Sciopero e corteo il 3 novembre", "2026-11-02T23:00:00Z", false, "explicit"], // winter time from 25 Oct
  ])("%s", (text, expected, timeKnown, kind) => {
    const r = parsePlannedStart(text, NOW, NOW);
    expect(r).not.toBeNull();
    expect(r!.start.toISOString()).toBe(iso(expected));
    expect(r!.timeKnown).toBe(timeKnown);
    expect(r!.kind).toBe(kind);
  });

  it("reads relative words against the publication time", () => {
    // Published Tuesday evening: "domani" means Wednesday (today).
    const published = new Date("2026-10-20T19:00:00Z");
    expect(parsePlannedStart("Domani alle 17 corteo", published, NOW)?.start.toISOString()).toBe(iso("2026-10-21T15:00:00Z"));
  });

  it.each([
    ["Il corteo del 3 ottobre si è concluso", "a past date"],
    ["Oggi alle 9 si è tenuto un presidio", "a time that has passed by more than an hour"],
    ["Corteo il 25 dicembre", "more than 30 days ahead"],
    ["Corteo in piazza Verdi, molta gente", "no date at all"],
    ["Ci vediamo alle 15", "a time without a day"],
  ])("returns null for %s (%s)", (text) => {
    expect(parsePlannedStart(text, NOW, NOW)).toBeNull();
  });

  it("rolls a January date written in December into next year", () => {
    const dec = new Date("2026-12-20T10:00:00Z");
    expect(parsePlannedStart("Corteo il 5 gennaio alle 15", dec, dec)?.start.toISOString()).toBe(iso("2027-01-05T14:00:00Z"));
  });
});

describe("Rome time helpers", () => {
  it("handles summer and winter time", () => {
    expect(romeTime(2026, 6, 1, 12).toISOString()).toBe(iso("2026-07-01T10:00:00Z"));
    expect(romeTime(2026, 0, 1, 12).toISOString()).toBe(iso("2026-01-01T11:00:00Z"));
    expect(romeDay(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
  });
});
