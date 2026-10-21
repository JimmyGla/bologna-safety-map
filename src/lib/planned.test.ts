import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { groupUpcoming, upcomingEventSchema, type PlannedRow } from "./planned";

const NOW = new Date("2026-10-21T12:00:00Z"); // Wed 14:00 in Rome
const UNITA = latLngToCell(44.5075, 11.348, 9);
const MAGGIORE = latLngToCell(44.4938, 11.3431, 9);

const row = (over: Partial<PlannedRow> = {}): PlannedRow => ({
  eventType: "march",
  startsAt: new Date("2026-10-24T13:00:00Z"), // Sat 15:00
  timeKnown: true,
  locationNames: ["Piazza dell'Unità"],
  h3Cells: [UNITA],
  sourceFeed: "news:carlino",
  sourceClass: "news",
  ...over,
});

describe("groupUpcoming", () => {
  it("merges reports of the same event and counts independent feeds", () => {
    const [e, ...rest] = groupUpcoming(
      [row(), row({ sourceFeed: "news:repubblica", startsAt: new Date("2026-10-24T13:30:00Z") }), row({ sourceFeed: "reddit:r/bologna", sourceClass: "social" })],
      NOW,
    );
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ eventType: "march", timeKnown: true, sourceCount: 3, officialSource: true, startsAt: "2026-10-24T13:00:00.000Z", h3Cells: [UNITA] });
    expect(() => upcomingEventSchema.parse(e)).not.toThrow();
  });

  it("keeps different places, days or times apart", () => {
    const events = groupUpcoming(
      [
        row(),
        row({ h3Cells: [MAGGIORE], locationNames: ["Piazza Maggiore"] }),
        row({ startsAt: new Date("2026-10-25T13:00:00Z") }),
        row({ startsAt: new Date("2026-10-24T18:00:00Z") }), // 5h later, same place
      ],
      NOW,
    );
    expect(events).toHaveLength(4);
  });

  it("lets a day-only report join a timed one and takes the known time", () => {
    const [e] = groupUpcoming([row({ timeKnown: false, startsAt: new Date("2026-10-23T22:00:00Z") }), row({ sourceFeed: "news:repubblica" })], NOW);
    expect(e).toMatchObject({ timeKnown: true, startsAt: "2026-10-24T13:00:00.000Z", sourceCount: 2 });
  });

  it("applies the corroboration gate: one social source is not enough", () => {
    expect(groupUpcoming([row({ sourceFeed: "reddit:r/bologna", sourceClass: "social" })], NOW)).toEqual([]);
    expect(
      groupUpcoming([row({ sourceFeed: "reddit:r/bologna", sourceClass: "social" }), row({ sourceFeed: "mastodon:mastodon.uno", sourceClass: "social" })], NOW),
    ).toHaveLength(1);
    expect(groupUpcoming([row({ sourceFeed: "tper:telegram", sourceClass: "transit" })], NOW)).toHaveLength(1);
  });

  it("shows the next 7 days and keeps an event 12h after its start", () => {
    const events = groupUpcoming(
      [
        row({ startsAt: new Date("2026-10-21T02:00:00Z") }), // 10h ago: still listed
        row({ startsAt: new Date("2026-10-20T20:00:00Z"), h3Cells: [MAGGIORE] }), // 16h ago: gone
        row({ startsAt: new Date("2026-10-30T13:00:00Z") }), // 9 days ahead: not yet
        row({ h3Cells: [] }), // no place: never
      ],
      NOW,
    );
    expect(events.map((e) => e.startsAt)).toEqual(["2026-10-21T02:00:00.000Z"]);
  });

  it("sorts by start time", () => {
    const events = groupUpcoming([row({ startsAt: new Date("2026-10-26T13:00:00Z") }), row({ h3Cells: [MAGGIORE], startsAt: new Date("2026-10-22T08:00:00Z") })], NOW);
    expect(events.map((e) => e.startsAt)).toEqual(["2026-10-22T08:00:00.000Z", "2026-10-26T13:00:00.000Z"]);
  });
});
