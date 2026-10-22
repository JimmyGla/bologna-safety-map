import { romeDay, romeParts, romeTime } from "@/lib/dates";
import { EVENT_TYPES, type EventType } from "@/lib/event-types";

// Report figures from the anonymous archive. Pure and client-safe: the server loads rows
// (src/lib/report/data.ts), this turns them into what /report shows.

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const DEFAULT_RANGE: ReportRange = 30;

export const GROUPS = ["protest", "violence", "vandalism"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_OF: Record<EventType, Group> = {
  march: "protest",
  blockade: "protest",
  peaceful_gathering: "protest",
  police_presence: "protest",
  clashes: "protest",
  aftermath: "protest",
  assault: "violence",
  hate_attack: "violence",
  sexual_violence: "violence",
  vandalism: "vandalism",
};

/** One archived event as the report needs it (no cells, no ids). */
export type ReportEvent = {
  period: string;
  eventType: EventType;
  sourceClass: "social" | "news" | "official" | "transit";
  quartieri: string[];
};
/** Area-hours per Rome day at orange or red (≥3) and at red (4), from archive_levels. */
export type LevelDay = { day: string; high: number; red: number };

export type Report = {
  range: ReportRange;
  from: string;
  to: string;
  totals: { events: number; daysWithEvents: number; highAreaHours: number; authoritativeShare: number };
  byDay: ({ day: string; total: number; highAreaHours: number } & Record<Group, number>)[];
  byType: { type: EventType; count: number }[];
  byQuartiere: ({ quartiere: string; total: number } & Record<Group, number>)[];
};

const AUTHORITATIVE = new Set(["news", "official", "transit"]);

/** The Rome days of the range, oldest first, ending today. */
export function rangeDays(now: Date, range: number): string[] {
  const p = romeParts(now);
  return Array.from({ length: range }, (_, i) => romeDay(romeTime(p.y, p.m, p.d - (range - 1 - i), 12)));
}

const emptyGroups = (): Record<Group, number> => ({ protest: 0, violence: 0, vandalism: 0 });

export function buildReport(events: ReportEvent[], levels: LevelDay[], now: Date, range: ReportRange, quartieri: string[]): Report {
  const days = rangeDays(now, range);
  const inRange = new Set(days);
  const byDay = new Map(days.map((d) => [d, { day: d, total: 0, highAreaHours: 0, ...emptyGroups() }]));
  const byType = new Map<EventType, number>(EVENT_TYPES.map((t) => [t, 0]));
  const byQuartiere = new Map(quartieri.map((q) => [q, { quartiere: q, total: 0, ...emptyGroups() }]));
  let counted = 0;
  let authoritative = 0;

  for (const e of events) {
    const day = romeDay(new Date(e.period));
    const d = byDay.get(day);
    if (!d) continue;
    const g = GROUP_OF[e.eventType];
    d.total++;
    d[g]++;
    byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
    for (const q of e.quartieri) {
      const row = byQuartiere.get(q);
      if (!row) continue;
      row.total++;
      row[g]++;
    }
    counted++;
    if (AUTHORITATIVE.has(e.sourceClass)) authoritative++;
  }
  let highAreaHours = 0;
  for (const l of levels) {
    if (!inRange.has(l.day)) continue;
    byDay.get(l.day)!.highAreaHours += l.high;
    highAreaHours += l.high;
  }

  const dayRows = [...byDay.values()];
  return {
    range,
    from: days[0],
    to: days[days.length - 1],
    totals: {
      events: counted,
      daysWithEvents: dayRows.filter((d) => d.total > 0).length,
      highAreaHours,
      authoritativeShare: counted ? authoritative / counted : 0,
    },
    byDay: dayRows,
    byType: [...byType].map(([type, count]) => ({ type, count })).filter((t) => t.count > 0).sort((a, b) => b.count - a.count),
    byQuartiere: [...byQuartiere.values()].sort((a, b) => b.total - a.total || a.quartiere.localeCompare(b.quartiere)),
  };
}

export function parseRange(v: string | string[] | undefined): ReportRange {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (REPORT_RANGES as readonly number[]).includes(n) ? (n as ReportRange) : DEFAULT_RANGE;
}

/** RFC 4180 CSV. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
